// コアエンジン: 状態遷移・出題スケジューラ・ヒント機構・判定・localStorage永続化
// モジュール(verbs/numbers)を関知しない汎用ロジック(SPEC 3〜7・10)。

const STORAGE_KEY = "seiken4_drill_v1";

// 出題モードの抽象化。
// "input"(入力式)に加え、4択モード("choice")を追加(SPEC 8.2)。
// Engine#startSession の opts.mode = MODES.MIXED で settings.choiceRatio に応じて
// 問題ごとに input/choice をランダムに振り分ける。
export const MODES = {
  INPUT: "input",
  CHOICE: "choice",
  MIXED: "mixed",
};

// 既定設定値(SPEC 10)
const DEFAULT_SETTINGS = {
  lenientAccent: true, // 寛容モード: アクセント記号のみの誤りを△扱い
  sessionSize: 20,
  excludeVosotros: false,
  includeGerundio: false, // SPEC 11.1 任意(現在分詞)
  choiceRatio: 0.3, // SPEC 8.2: セッション内で4択を出題する割合(0〜1)
  requireInputForMastery: true, // SPEC 8.2: 習得済み化に入力式の無ヒント正解を最低1回要求する
  soundEffects: true, // 正解時の効果音(連続正解で高揚感を出す)
};

// 「ノーヒント正解2回」の間隔条件(SPEC 4-5): 同一セッション内連続は不可。
// 4時間以上空けるか、セッションをまたぐことを要求する。
const MASTER_INTERVAL_MS = 4 * 60 * 60 * 1000;

// セッション内再出題までの距離(SPEC 4-2): 3〜5問後、挿入位置はランダム±1
const REQUEUE_MIN = 3;
const REQUEUE_MAX = 5;

// 新規投入の tier 重み(SPEC 4-6)
const TIER_WEIGHTS = { 1: 5, 2: 3, 3: 1 };

// アクセント記号除去(寛容モード判定・正規化用)
const ACCENT_MAP = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" };
function stripAccents(s) {
  return s
    .split("")
    .map((c) => ACCENT_MAP[c] ?? c)
    .join("");
}

// 入力の正規化(SPEC 7.1): 前後空白除去 + 小文字化。アクセントは正規化しない。
function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function now() {
  return Date.now();
}

/**
 * DrillEngine: モジュール登録・データロード・出題・判定・永続化を担う。
 */
export class DrillEngine {
  constructor() {
    /** @type {Map<string, object>} moduleId -> module(ModuleInterface実装) */
    this.modules = new Map();
    /** @type {Map<string, {item: object, module: object}>} itemId -> {item, module} */
    this.itemsById = new Map();
    /** @type {object|null} data/explanations.json */
    this.explanations = null;
    /** @type {object} localStorage永続データ(SPEC 10スキーマ) */
    this.state = null;

    // セッション中の一時状態
    this.session = null;
    this.sessionStartedAt = null;
    // endSession()後にstartRetestSession()で参照する直前セッションの情報(SPEC 4-3, 4-5)
    this._lastSessionEnd = null;
  }

  // -----------------------------------------------------------------------
  // データロード
  // -----------------------------------------------------------------------

  /**
   * 各モジュールに対応するJSONを fetch して init() に注入し、学習項目を列挙する。
   * @param {{verbs: object, numbers: object}} modules - id -> モジュール実装
   * @param {string} [baseUrl] - data/ のベースURL(既定 "data/")
   */
  async loadData(modules, baseUrl = "data/") {
    for (const [id, mod] of Object.entries(modules)) {
      this.modules.set(id, mod);
      const res = await fetch(`${baseUrl}${id}.json`);
      if (!res.ok) {
        throw new Error(`データの読み込みに失敗しました: ${baseUrl}${id}.json (HTTP ${res.status})`);
      }
      const data = await res.json();
      mod.init(data);
    }
    const expRes = await fetch(`${baseUrl}explanations.json`);
    if (!expRes.ok) {
      throw new Error(`データの読み込みに失敗しました: ${baseUrl}explanations.json (HTTP ${expRes.status})`);
    }
    this.explanations = await expRes.json();

    this._rebuildItemIndex();
    this._loadState();
    this._migrateNewItems();
  }

  /**
   * fetchを使わず、既に取得済みのJSONデータを直接注入する(テスト/SSR向け)。
   * @param {{[moduleId: string]: {module: object, data: object}}} modules
   * @param {object} explanations
   */
  loadDataDirect(modules, explanations) {
    for (const [id, { module: mod, data }] of Object.entries(modules)) {
      this.modules.set(id, mod);
      mod.init(data);
    }
    this.explanations = explanations;
    this._rebuildItemIndex();
    this._loadState();
    this._migrateNewItems();
  }

  _rebuildItemIndex() {
    this.itemsById.clear();
    for (const [, mod] of this.modules) {
      for (const item of mod.generateItems()) {
        this.itemsById.set(item.id, { item, module: mod });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 永続化(SPEC 10)
  // -----------------------------------------------------------------------

  _defaultState() {
    return {
      examDate: null,
      settings: { ...DEFAULT_SETTINGS },
      items: {},
      themeStats: {},
      sessions: [],
    };
  }

  _loadState() {
    let stored = null;
    try {
      const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) stored = JSON.parse(raw);
    } catch (e) {
      stored = null;
    }
    const base = this._defaultState();
    if (stored) {
      this.state = {
        ...base,
        ...stored,
        settings: { ...base.settings, ...(stored.settings || {}) },
        items: stored.items || {},
        themeStats: stored.themeStats || {},
        sessions: stored.sessions || [],
      };
    } else {
      this.state = base;
    }
  }

  /** 新規追加されたItemをstate.itemsに "new" 状態で登録する */
  _migrateNewItems() {
    for (const id of this.itemsById.keys()) {
      if (!this.state.items[id]) {
        this.state.items[id] = this._newItemRecord();
      } else if (this.state.items[id].cleanInputCorrect == null) {
        // 既存データのマイグレーション: cleanInputCorrect追加(SPEC 8.2)。
        // 既に習得済みの項目は入力式正解済みとみなして遡及要求しない。
        const rec = this.state.items[id];
        rec.cleanInputCorrect = rec.state === "mastered" ? 1 : 0;
      }
    }
  }

  _newItemRecord() {
    return {
      state: "new",
      cleanCorrect: 0,
      assistedCorrect: 0,
      wrong: 0,
      hintsMax: 0,
      lastSeen: null,
      dueAt: null,
      lastCleanCorrectAt: null,
      cleanInputCorrect: 0, // SPEC 8.2: 入力式での無ヒント正解回数(習得済み化の条件)
    };
  }

  /** state全体をlocalStorageに保存する */
  save() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch (e) {
      // localStorage不可(プライベートモード等)は無視
    }
  }

  /** 設定を更新して保存する */
  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
  }

  getSettings() {
    return this.state.settings;
  }

  /** 試験日を設定する("YYYY-MM-DD") */
  setExamDate(dateStr) {
    this.state.examDate = dateStr;
    this.save();
  }

  /** データを初期化する(SPEC 9.5: 2段階確認はUI側で実施し、ここでは即実行) */
  resetAllData() {
    this.state = this._defaultState();
    this._migrateNewItems();
    this.save();
  }

  // -----------------------------------------------------------------------
  // ホーム画面向け集計(SPEC 9.2)
  // -----------------------------------------------------------------------

  /**
   * 試験日までの残り日数(今日を0日目として切り上げ)。examDate未設定ならnull。
   * @returns {number|null}
   */
  daysUntilExam() {
    if (!this.state.examDate) return null;
    const exam = new Date(`${this.state.examDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exam.setHours(0, 0, 0, 0);
    const diffMs = exam.getTime() - today.getTime();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  }

  /**
   * 集計対象として数えてよい項目かどうか(SPEC 4-6/P0-4/P1-9)。
   * - itemsById に存在しない(データ更新で消えた・cold数のID変化等による孤児)レコードは除外
   * - excludeVosotros等の設定で出題対象から除外された項目も除外
   * @param {string} id
   * @returns {boolean}
   */
  _isCountable(id) {
    const entry = this.itemsById.get(id);
    if (!entry) return false; // 孤児レコード(itemsByIdに存在しない)
    if (this._isExcluded(entry.item)) return false;
    return true;
  }

  /** 全項目中、state !== "mastered" の件数(出題不能項目を除く) */
  unmasteredCount(moduleId = null) {
    let count = 0;
    for (const [id, rec] of Object.entries(this.state.items)) {
      if (moduleId && !id.startsWith(`${moduleId}:`)) continue;
      if (!this._isCountable(id)) continue;
      if (rec.state !== "mastered") count++;
    }
    return count;
  }

  /** 習得済み件数(出題不能項目を除く) */
  masteredCount(moduleId = null) {
    let count = 0;
    for (const [id, rec] of Object.entries(this.state.items)) {
      if (moduleId && !id.startsWith(`${moduleId}:`)) continue;
      if (!this._isCountable(id)) continue;
      if (rec.state === "mastered") count++;
    }
    return count;
  }

  /** 学習中件数(出題不能項目を除く) */
  learningCount(moduleId = null) {
    let count = 0;
    for (const [id, rec] of Object.entries(this.state.items)) {
      if (moduleId && !id.startsWith(`${moduleId}:`)) continue;
      if (!this._isCountable(id)) continue;
      if (rec.state === "learning") count++;
    }
    return count;
  }

  /** 全項目数(出題不能項目を除く) */
  totalCount(moduleId = null) {
    let count = 0;
    for (const [id, entry] of this.itemsById) {
      if (moduleId && !id.startsWith(`${moduleId}:`)) continue;
      if (this._isExcluded(entry.item)) continue;
      count++;
    }
    return count;
  }

  /**
   * 今日のノルマ(項目数) = 未習得項目数 ÷ 残り日数(切り上げ)。
   * 試験日未設定・残り日数が0以下なら未習得数そのものを返す。
   * @returns {number}
   */
  todaysGoal() {
    const remaining = this.unmasteredCount();
    const days = this.daysUntilExam();
    if (days === null || days <= 0) return remaining;
    return Math.ceil(remaining / days);
  }

  /**
   * 今日すでに完了した項目数(SPEC 9.2の進捗バー用)。
   * 今日のセッションで cleanCorrect が加算された項目数を簡易集計する。
   */
  todaysProgress() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const startMs = todayStart.getTime();
    let count = 0;
    for (const rec of Object.values(this.state.items)) {
      if (rec.lastCleanCorrectAt && rec.lastCleanCorrectAt >= startMs) count++;
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // 知識マップ(SPEC 9.1, 11.4)
  // -----------------------------------------------------------------------

  /**
   * 項目1件の習得状況を3値(未学習/学習中/習得済み)に分類する。
   * @param {string} itemId
   * @returns {"new"|"learning"|"mastered"}
   */
  _cellStatus(itemId) {
    const rec = this.state.items[itemId];
    if (!rec) return "new";
    return rec.state;
  }

  /**
   * 動詞モジュールの知識マップ用マトリクスを構築する(SPEC 11.4)。
   * 行 = 時制・法(gustar型は別行)、列 = 動詞タイプ(VERB_TYPESの列キー)。
   * @returns {{rows: Array<{key:string, cells: object}>, cols: string[]}}
   *   cells[colKey] = {total, mastered, learning, new}
   */
  verbKnowledgeMap() {
    // 行の並び順(SPEC 11.1の出題範囲 + gustar型)
    const ROW_ORDER = ["pres", "pret", "imperf", "fut", "cond", "subj", "imp_af", "imp_neg", "participio", "perfecto", "ger", "gustar"];
    const cols = new Set();
    const grid = new Map(); // rowKey -> Map(colKey -> {total, mastered, learning, new})

    for (const [id, entry] of this.itemsById) {
      const { item } = entry;
      if (item.moduleId !== "verbs") continue;
      const { tense, type, verbType } = item.payload;
      const rowKey = type === "gustar" ? "gustar" : (tense ?? "?");
      const colKey = type === "gustar" ? "gustar" : (verbType ?? "regular");
      cols.add(colKey);

      if (!grid.has(rowKey)) grid.set(rowKey, new Map());
      const rowMap = grid.get(rowKey);
      if (!rowMap.has(colKey)) rowMap.set(colKey, { total: 0, mastered: 0, learning: 0, new: 0 });
      const cell = rowMap.get(colKey);
      cell.total++;
      const status = this._cellStatus(id);
      cell[status] = (cell[status] ?? 0) + 1;
    }

    const rows = [];
    for (const rowKey of ROW_ORDER) {
      if (!grid.has(rowKey)) continue;
      rows.push({ key: rowKey, cells: Object.fromEntries(grid.get(rowKey)) });
    }
    // ROW_ORDERに無い行(将来追加分)も末尾に含める
    for (const [rowKey, cellMap] of grid) {
      if (ROW_ORDER.includes(rowKey)) continue;
      rows.push({ key: rowKey, cells: Object.fromEntries(cellMap) });
    }

    return { rows, cols: [...cols] };
  }

  /**
   * 数字モジュールの知識マップ用(レベル1〜5)集計を構築する(SPEC 9.1)。
   * @returns {Array<{level:number, total:number, mastered:number, learning:number, new:number}>}
   */
  numberKnowledgeMap() {
    const byLevel = new Map();
    for (const [id, entry] of this.itemsById) {
      const { item } = entry;
      if (item.moduleId !== "numbers") continue;
      const level = item.payload.level;
      if (!byLevel.has(level)) byLevel.set(level, { level, total: 0, mastered: 0, learning: 0, new: 0 });
      const cell = byLevel.get(level);
      cell.total++;
      const status = this._cellStatus(id);
      cell[status] = (cell[status] ?? 0) + 1;
    }
    return [...byLevel.values()].sort((a, b) => a.level - b.level);
  }

  // -----------------------------------------------------------------------
  // 出題スケジューラ(SPEC 4)
  // -----------------------------------------------------------------------

  /**
   * テーマキーを算出する(SPEC 4-7: 動詞=時制×動詞タイプ / 数字=レベル)。
   * @param {object} entry - {item, module}
   * @returns {string}
   */
  _themeKey(entry) {
    const { item } = entry;
    if (item.moduleId === "verbs") {
      const { tense, type } = item.payload;
      if (type === "gustar") return "verbs:gustar";
      return `verbs:${tense ?? "?"}`;
    }
    if (item.moduleId === "numbers") {
      return `numbers:L${item.payload.level}`;
    }
    return `${item.moduleId}:other`;
  }

  /** テーマの正答率(0〜1)。記録なしは1(=弱点でない)とみなす */
  _themeAccuracy(themeKey) {
    const s = this.state.themeStats[themeKey];
    if (!s || s.right + s.wrong === 0) return 1;
    return s.right / (s.right + s.wrong);
  }

  /**
   * 設定により出題対象から除外すべき項目か判定する(SPEC 9.5: vosotros除外)。
   * @param {object} item
   * @returns {boolean}
   */
  _isExcluded(item) {
    if (this.state.settings.excludeVosotros && item.payload && item.payload.person === "vosotros") {
      return true;
    }
    return false;
  }

  /**
   * 復習キュー(due到来の learning 項目)を取得する。
   * @param {string|null} moduleId - 指定時はそのモジュールのみ
   * @returns {Array<{item, module, record}>}
   */
  _dueReviewItems(moduleId = null) {
    const t = now();
    const out = [];
    for (const [id, entry] of this.itemsById) {
      if (moduleId && entry.item.moduleId !== moduleId) continue;
      if (this._isExcluded(entry.item)) continue;
      const rec = this.state.items[id];
      if (!rec) continue;
      if (rec.state === "learning" && rec.dueAt != null && rec.dueAt <= t) {
        out.push({ ...entry, record: rec });
      }
    }
    // 期限が古いもの(より長く待たされたもの)を優先
    out.sort((a, b) => (a.record.dueAt ?? 0) - (b.record.dueAt ?? 0));
    return out;
  }

  /**
   * 未学習(new)項目から tier重み + 弱点テーマ重みでランダムに1件選ぶ。
   * @param {string|null} moduleId
   * @returns {{item, module, record}|null}
   */
  _pickNewItem(moduleId = null) {
    const candidates = [];
    for (const [id, entry] of this.itemsById) {
      if (moduleId && entry.item.moduleId !== moduleId) continue;
      if (this._isExcluded(entry.item)) continue;
      const rec = this.state.items[id];
      if (!rec || rec.state !== "new") continue;
      candidates.push({ ...entry, record: rec });
    }
    if (candidates.length === 0) return null;

    const weights = candidates.map((c) => {
      const tierW = TIER_WEIGHTS[c.item.tier] ?? 1;
      const themeKey = this._themeKey(c);
      const acc = this._themeAccuracy(themeKey);
      // 正答率が低いテーマほど重みを増す(SPEC 4-7): 1.0〜2.5倍
      const themeBoost = 1 + (1 - acc) * 1.5;
      return tierW * themeBoost;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  /**
   * セッション用の出題キューを構築する(SPEC 4-1, 4-4, 4-6, 4-7)。
   * 翌日再テスト(4-4)はdueAt<=nowの復習キュー(4-1)に統合済みなので別処理不要。
   * @param {object} [opts]
   * @param {string|null} [opts.moduleId] - 出題対象モジュール(null=全モジュール)
   * @param {number} [opts.size] - 出題数(既定: settings.sessionSize)
   * @param {string} [opts.numberMode] - SPEC 8.3: 数字モジュールの出題モード上書き
   *   ("spell"|"to_number"|"listen"。指定時はnumbersモジュールの項目のpayload.modeを上書きする)
   * @returns {object[]} Item配列
   */
  buildQueue(opts = {}) {
    const moduleId = opts.moduleId ?? null;
    const size = opts.size ?? this.state.settings.sessionSize ?? DEFAULT_SETTINGS.sessionSize;

    const queue = [];
    const used = new Set();

    // 1. 復習キュー優先(期限到来の学習中項目 = 翌日再テストも含む)
    const due = this._dueReviewItems(moduleId);
    for (const entry of due) {
      if (queue.length >= size) break;
      queue.push(entry.item);
      used.add(entry.item.id);
    }

    // 6/7. 残りの枠を tier重み + 弱点テーマ重みの新規項目で埋める
    let guard = 0;
    while (queue.length < size && guard < size * 20) {
      guard++;
      const picked = this._pickNewItem(moduleId);
      if (!picked) break;
      if (used.has(picked.item.id)) continue;
      queue.push(picked.item);
      used.add(picked.item.id);
    }

    // まだ枠が残っていれば、learning(未期限到来)/mastered からも補充する
    if (queue.length < size) {
      const fallback = [];
      for (const [id, entry] of this.itemsById) {
        if (moduleId && entry.item.moduleId !== moduleId) continue;
        if (this._isExcluded(entry.item)) continue;
        if (used.has(id)) continue;
        fallback.push(entry.item);
      }
      // シャッフルして必要数だけ追加
      for (let i = fallback.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fallback[i], fallback[j]] = [fallback[j], fallback[i]];
      }
      for (const item of fallback) {
        if (queue.length >= size) break;
        queue.push(item);
        used.add(item.id);
      }
    }

    // 数字モジュールの出題モード上書き(SPEC 8.3): id・tier等は維持し、payload.modeのみ差し替える
    if (opts.numberMode) {
      return queue.map((item) => {
        if (item.moduleId !== "numbers") return item;
        return { ...item, payload: { ...item.payload, mode: opts.numberMode } };
      });
    }

    return queue;
  }

  /**
   * セッションを開始する。
   * @param {object} [opts]
   * @param {string|null} [opts.moduleId]
   * @param {number} [opts.size]
   * @param {string} [opts.mode] - MODES.* (MIXEDの場合は問題ごとにsettings.choiceRatioで振り分け)
   * @returns {object} session情報(最初の問題を含む)
   */
  startSession(opts = {}) {
    const queue = this.buildQueue(opts);
    this.sessionStartedAt = now();
    this.session = {
      mode: opts.mode ?? MODES.INPUT,
      moduleId: opts.moduleId ?? null,
      queue, // 出題予定のItem配列(先頭が次の問題)
      index: 0, // queue内の現在位置
      asked: 0,
      right: 0, // ノーヒント正解(補助なし)
      wrong: 0,
      stumbled: [], // つまずいた項目id(SPEC 4-2, 4-3用)
      themesMissed: new Set(),
      current: null, // 現在出題中のItem
      currentMode: MODES.INPUT, // 現在の問題の出題モード(MIXED時に問題ごとに決定)
      hintsUsed: [], // 現在の問題で使用済みのヒント段階
      knownAsWrong: false, // 現在の問題が「わからない」/H3超で誤答確定済みか
    };
    this._advance();
    return this.getSessionView();
  }

  /**
   * 現在の問題の出題モードを決定する(SPEC 8.2: MIXED時はsettings.choiceRatioで振り分け)。
   * @returns {string} MODES.INPUT | MODES.CHOICE
   */
  _decideQuestionMode() {
    const sessionMode = this.session.mode;
    if (sessionMode === MODES.CHOICE) return MODES.CHOICE;
    if (sessionMode === MODES.MIXED) {
      const ratio = this.state.settings.choiceRatio ?? DEFAULT_SETTINGS.choiceRatio;
      return Math.random() < ratio ? MODES.CHOICE : MODES.INPUT;
    }
    return MODES.INPUT;
  }

  /** 次の問題へ進める(内部用) */
  _advance() {
    if (!this.session) return null;
    if (this.session.index >= this.session.queue.length) {
      this.session.current = null;
      return null;
    }
    const item = this.session.queue[this.session.index];
    this.session.index++;
    this.session.current = item;
    this.session.currentMode = this._decideQuestionMode();
    this.session.hintsUsed = [];
    this.session.knownAsWrong = false;
    return item;
  }

  /**
   * 現在のセッション状況をUI向けに整形する。
   * @returns {object|null}
   */
  getSessionView() {
    if (!this.session) return null;
    const s = this.session;
    if (!s.current) {
      return {
        finished: true,
        asked: s.asked,
        total: s.queue.length,
        right: s.right,
        wrong: s.wrong,
      };
    }
    const entry = this.itemsById.get(s.current.id);
    const answer = entry.module.answerFor(s.current);
    const record = this.state.items[s.current.id];
    const view = {
      finished: false,
      item: s.current,
      mode: s.currentMode,
      asked: s.asked,
      total: s.queue.length,
      right: s.right,
      wrong: s.wrong,
      hintsUsed: [...s.hintsUsed],
      maxHintStage: this._maxHintStage(s.current, answer, record),
      segmentsLength: answer.segments.length,
    };
    if (s.currentMode === MODES.CHOICE) {
      view.choices = this._buildChoices(s.current, entry, answer);
    }
    return view;
  }

  /**
   * 4択の選択肢を構築する(SPEC 8.2)。正解 + distractorsFor()のダミー3つをシャッフルする。
   * @returns {string[]}
   */
  _buildChoices(item, entry, answer) {
    const distractors = entry.module.distractorsFor(item, answer);
    const choices = [answer.text, ...distractors];
    // シャッフル(Fisher-Yates)
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return choices;
  }

  // -----------------------------------------------------------------------
  // ヒント機構(SPEC 5)
  // -----------------------------------------------------------------------

  /**
   * 「補助付き正解を2回以上経た」項目かどうか(SPEC 5: 足場の漸減)。
   * @param {object} record
   * @returns {boolean}
   */
  _isScaffoldReduced(record) {
    return record && record.state === "learning" && (record.assistedCorrect ?? 0) >= 2;
  }

  /**
   * この項目で到達できる最大ヒント段階(1〜3)。
   * 足場漸減対象はH3相当のみ(=1段階しかない)。
   */
  _maxHintStage(item, answer, record) {
    return this._isScaffoldReduced(record) ? 1 : 3;
  }

  /**
   * 次のヒント段階を要求する。
   * 段階は何度でも押せるが進むだけ。最終段階を超えて押すと「わからない」と同じ扱い。
   * @returns {{stage: number, hint: object, treatAsUnknown: boolean}}
   */
  requestHint() {
    const s = this.session;
    if (!s || !s.current) return null;
    const entry = this.itemsById.get(s.current.id);
    const answer = entry.module.answerFor(s.current);
    const zone = entry.module.criticalZone(s.current, answer);
    const record = this.state.items[s.current.id];
    const scaffoldReduced = this._isScaffoldReduced(record);
    const maxStage = this._maxHintStage(s.current, answer, record);

    const currentStage = s.hintsUsed.length > 0 ? Math.max(...s.hintsUsed) : 0;
    const nextStage = currentStage + 1;

    if (nextStage > maxStage) {
      // 最終段階を超えた要求 = 「わからない」と同じ扱い
      return { stage: currentStage, hint: null, treatAsUnknown: true };
    }

    // 足場漸減対象はH3相当のみ(段階1扱い)なのでstage表示は1だが、内容はH3相当
    const effectiveStage = scaffoldReduced ? 3 : nextStage;
    const hint = this._buildHint(effectiveStage, answer, zone, s.current);

    if (!s.hintsUsed.includes(nextStage)) s.hintsUsed.push(nextStage);
    return { stage: nextStage, hint, treatAsUnknown: false };
  }

  /**
   * 指定段階のヒント内容を構築する(SPEC 5)。
   * H1: 文字数マス/語数, H2: 非critical segment開示, H3: criticalの先頭1文字
   * @param {1|2|3} stage
   * @param {{text:string, segments: Array}} answer
   * @param {{criticalIndexes: number[], segments: Array}} zone
   * @param {object} item
   * @returns {object}
   */
  _buildHint(stage, answer, zone, item) {
    const lenient = this.state.settings.lenientAccent;
    const isNumbers = item.moduleId === "numbers";
    const isDigitMode = item.payload?.mode === "to_number" || item.payload?.mode === "listen";
    const segments = answer.segments;
    const criticalSet = new Set(zone.criticalIndexes);

    if (stage === 1) {
      // H1: 文字数マス(動詞)/語数・桁数(数字)
      if (isNumbers) {
        return {
          stage: 1,
          type: "word-count",
          wordCount: segments.length,
          unit: isDigitMode ? "桁" : "語",
          display: segments.map(() => (isDigitMode ? "_" : "___")).join(" "),
        };
      }
      // 文字数マス。寛容モードONならアクセント付き文字を強調表示する
      const display = answer.text
        .split("")
        .map((ch) => {
          if (ch === " ") return " ";
          const isAccent = lenient && /[áéíóúñü]/i.test(ch);
          return isAccent ? "Á" : "_"; // 強調マスは大文字Áで示す(UI側でCSS装飾)
        })
        .join(" ");
      return { stage: 1, type: "char-count", display, length: answer.text.length };
    }

    if (stage === 2) {
      // H2: 非criticalなsegmentを開示(桁入力モードは全桁critical=全マスのまま)
      const display = segments
        .map((seg, i) => (criticalSet.has(i) ? maskSegment(seg, isNumbers, isDigitMode) : seg.text))
        .join(isNumbers ? " " : "");
      return { stage: 2, type: "partial-reveal", display };
    }

    // H3: criticalゾーンの先頭1文字を開示(数字はクリティカル語の頭文字+残りマスク、
    // 桁入力モードは先頭桁=1文字なのでそのまま開示)
    const firstCriticalIdx = zone.criticalIndexes[0];
    const display = segments
      .map((seg, i) => {
        if (i === firstCriticalIdx) {
          return seg.text[0] + maskSegment(seg, isNumbers, isDigitMode).slice(1);
        }
        return criticalSet.has(i) ? maskSegment(seg, isNumbers, isDigitMode) : seg.text;
      })
      .join(isNumbers ? " " : "");
    return { stage: 3, type: "critical-first", display };
  }

  // -----------------------------------------------------------------------
  // 判定(SPEC 7.1) + 解答処理
  // -----------------------------------------------------------------------

  /**
   * 入力を判定し、状態遷移・記録更新を行う。
   * @param {string} input
   * @returns {object} 判定結果(UI表示用)
   */
  submitAnswer(input) {
    const s = this.session;
    if (!s || !s.current) return null;
    const item = s.current;
    const entry = this.itemsById.get(item.id);
    const answer = entry.module.answerFor(item);

    const a = normalize(answer.text);
    const u = normalize(input);
    // 4択モードはダミーに意図的なアクセント除去形が含まれる(SPEC 8.2④)ため、
    // 寛容モードの半正解(partial)判定は入力式のみで行う。
    const lenient = this.state.settings.lenientAccent && s.currentMode !== MODES.CHOICE;

    let result; // "correct" | "partial" | "wrong"
    if (a === u) {
      result = "correct";
    } else if (lenient && stripAccents(a) === stripAccents(u)) {
      result = "partial"; // △(半正解): その場では正解扱いだが復習キューに入る
    } else {
      result = "wrong";
    }

    const hintsUsedThisTurn = [...s.hintsUsed];
    const assisted = hintsUsedThisTurn.length > 0;

    let errorTags = [];
    if (result === "wrong") {
      errorTags = entry.module.classifyError(item, input, answer);
    } else if (result === "partial") {
      errorTags = ["accent_missing"];
    }

    const outcome = this._applyResult(item, entry, result, assisted, hintsUsedThisTurn, errorTags, s.currentMode);

    s.asked++;
    if (result === "correct" && !assisted) {
      s.right++;
    } else {
      s.wrong++;
      s.stumbled.push(item.id);
      this._scheduleRequeue(item);
      const themeKey = this._themeKey(entry);
      s.themesMissed.add(themeKey);
    }

    let explanation = null;
    if (result === "wrong" || result === "partial") {
      explanation = entry.module.explanationFor(errorTags, item, this.explanations);
    }

    this.save();

    return {
      result, // correct | partial | wrong
      assisted,
      correctText: answer.text,
      errorTags,
      explanation,
      newState: outcome.newState,
      requeue: result !== "correct" || assisted,
    };
  }

  /**
   * 「わからない」ボタン。誤答として記録し、ミニ解説を返す(SPEC 6)。
   * @returns {object}
   */
  submitUnknown() {
    const s = this.session;
    if (!s || !s.current) return null;
    const item = s.current;
    const entry = this.itemsById.get(item.id);
    const answer = entry.module.answerFor(item);

    const errorTags = ["other"];
    const outcome = this._applyResult(item, entry, "unknown", false, [...s.hintsUsed], errorTags, s.currentMode);

    s.asked++;
    s.wrong++;
    s.stumbled.push(item.id);
    this._scheduleRequeue(item);
    s.themesMissed.add(this._themeKey(entry));

    const explanation = entry.module.explanationFor(errorTags, item, this.explanations);
    this.save();

    return {
      result: "unknown",
      assisted: false,
      correctText: answer.text,
      errorTags,
      explanation,
      newState: outcome.newState,
      requeue: true,
    };
  }

  /**
   * 状態遷移・記録更新(SPEC 3, 4-5)を適用する。
   * @param {object} item
   * @param {{item:object, module:object}} entry
   * @param {"correct"|"partial"|"wrong"|"unknown"} result
   * @param {boolean} assisted
   * @param {number[]} hintsUsedThisTurn
   * @param {string[]} errorTags
   * @param {string} [questionMode] - MODES.INPUT | MODES.CHOICE(SPEC 8.2の習得済み化条件判定用)
   * @returns {{newState: string}}
   */
  _applyResult(item, entry, result, assisted, hintsUsedThisTurn, errorTags, questionMode) {
    const id = item.id;
    const rec = this.state.items[id] ?? this._newItemRecord();
    const t = now();
    const prevState = rec.state;
    const requireInput = this.state.settings.requireInputForMastery ?? DEFAULT_SETTINGS.requireInputForMastery;

    if (hintsUsedThisTurn.length > 0) {
      rec.hintsMax = Math.max(rec.hintsMax ?? 0, Math.max(...hintsUsedThisTurn));
    }

    const isCorrectLike = result === "correct" || result === "partial";

    if (isCorrectLike) {
      if (assisted) {
        // 補助付き正解は「正解」とカウントしない。復習キューに残す。
        rec.assistedCorrect = (rec.assistedCorrect ?? 0) + 1;
        rec.state = "learning";
        rec.dueAt = this._nextDueAt(rec, "assisted");
      } else if (result === "partial") {
        // △: その場では正解扱いで進むが、復習キューには入れる
        rec.assistedCorrect = (rec.assistedCorrect ?? 0) + 1;
        rec.state = (prevState === "new") ? "learning" : prevState === "mastered" ? "learning" : "learning";
        rec.dueAt = this._nextDueAt(rec, "partial");
      } else {
        // ノーヒント正解(SPEC 8.2: 4択正解は同等に扱うが、習得済み化には入力式正解を要求)
        if (questionMode === MODES.INPUT) {
          rec.cleanInputCorrect = (rec.cleanInputCorrect ?? 0) + 1;
        }
        const canMaster = !requireInput || (rec.cleanInputCorrect ?? 0) >= 1;

        if (prevState === "new") {
          // 未学習 -> ノーヒント正解(初回) -> 習得済み(入力式正解が条件を満たす場合)
          rec.cleanCorrect = (rec.cleanCorrect ?? 0) + 1;
          rec.lastCleanCorrectAt = t;
          if (canMaster) {
            rec.state = "mastered";
            rec.dueAt = null;
          } else {
            rec.state = "learning";
            rec.dueAt = this._nextDueAt(rec, "clean-pending");
          }
        } else if (prevState === "learning") {
          // 学習中: ノーヒント正解を2回(間隔条件を満たして) -> 習得済み
          const intervalOk = this._intervalOk(rec, t);
          if (intervalOk) {
            rec.cleanCorrect = (rec.cleanCorrect ?? 0) + 1;
            rec.lastCleanCorrectAt = t;
            if (rec.cleanCorrect >= 2 && canMaster) {
              rec.state = "mastered";
              rec.dueAt = null;
            } else {
              rec.dueAt = this._nextDueAt(rec, "clean-pending");
            }
          } else {
            // 間隔条件を満たさない(同セッション内連続等): カウントせず復習キューに残す
            rec.dueAt = this._nextDueAt(rec, "clean-pending");
          }
        } else {
          // mastered での正解: 維持
          rec.cleanCorrect = (rec.cleanCorrect ?? 0) + 1;
          rec.lastCleanCorrectAt = t;
        }
      }
    } else {
      // wrong / unknown: 誤答 -> 学習中(復習キュー入り)。習得済みなら学習中に戻す。
      rec.wrong = (rec.wrong ?? 0) + 1;
      rec.state = "learning";
      rec.cleanCorrect = 0; // 間隔条件のやり直し
      rec.dueAt = this._nextDueAt(rec, "wrong");
    }

    rec.lastSeen = t;
    this.state.items[id] = rec;

    // テーマ別正答率(SPEC 4-7, themeStats)
    const themeKey = this._themeKey(entry);
    const themeStat = this.state.themeStats[themeKey] ?? { right: 0, wrong: 0 };
    if (result === "correct" && !assisted) {
      themeStat.right++;
    } else {
      themeStat.wrong++;
    }
    this.state.themeStats[themeKey] = themeStat;

    return { newState: rec.state };
  }

  /**
   * 「ノーヒント正解2回」の間隔条件(SPEC 4-5)を満たすか判定する。
   * 同一セッション内の連続では不可。最低でもセッションをまたぐ
   * (lastCleanCorrectAtが現在のセッション開始前)、または4時間以上空ける。
   */
  _intervalOk(rec, t) {
    if (!rec.lastCleanCorrectAt) return true;
    if (t - rec.lastCleanCorrectAt >= MASTER_INTERVAL_MS) return true;
    if (this.sessionStartedAt != null && rec.lastCleanCorrectAt < this.sessionStartedAt) return true;
    return false;
  }

  /**
   * 復習キューのdueAtを算出する(SPEC 4-1, 4-4)。
   * - assisted/partial/clean-pending: 翌日(セッション冒頭で再テスト対象)
   * - wrong: 翌日(同様)。即時のセッション内再出題は別途 _scheduleRequeue で処理。
   * @param {object} rec
   * @param {string} reason
   * @returns {number}
   */
  _nextDueAt(rec, reason) {
    const t = now();
    // 翌日0:00を基準にdueAtを設定する(SPEC 4-4: 翌日再テスト)
    const tomorrow = new Date(t);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * セッション内再出題(SPEC 4-2): つまずいた項目を3〜5問後、挿入位置±1で再挿入する。
   * @param {object} item
   */
  _scheduleRequeue(item) {
    const s = this.session;
    if (!s) return;
    const base = REQUEUE_MIN + Math.floor(Math.random() * (REQUEUE_MAX - REQUEUE_MIN + 1));
    const jitter = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
    let offset = Math.max(1, base + jitter);
    let insertAt = s.index + offset;
    if (insertAt > s.queue.length) insertAt = s.queue.length;
    s.queue.splice(insertAt, 0, item);
  }

  // -----------------------------------------------------------------------
  // セッション進行
  // -----------------------------------------------------------------------

  /** 現在の問題を終えて次へ進む */
  nextQuestion() {
    return this._advance();
  }

  /**
   * セッションを終了し、サマリを記録する(SPEC 9.4, SPEC 4-3)。
   * @returns {object} サマリ
   */
  endSession() {
    const s = this.session;
    if (!s) return null;
    const summary = {
      date: new Date().toISOString(),
      asked: s.asked,
      right: s.right,
      wrong: s.wrong,
      themesMissed: [...s.themesMissed],
      stumbledIds: [...new Set(s.stumbled)],
    };
    this.state.sessions.push(summary);
    // セッション履歴は直近50件まで保持
    if (this.state.sessions.length > 50) {
      this.state.sessions = this.state.sessions.slice(-50);
    }
    this.save();
    // startRetestSession()用に、終了したセッションの開始時刻とつまずいた項目を保持する
    // (SPEC 4-5: 再テストセッションは元セッションのsessionStartedAtを引き継ぐ)
    this._lastSessionEnd = {
      sessionStartedAt: this.sessionStartedAt,
      stumbledIds: summary.stumbledIds,
    };
    this.session = null;
    this.sessionStartedAt = null;
    return summary;
  }

  /**
   * 現在(または直前に終了した)セッションでつまずいた項目を集めてミニ再テストキューを作る(SPEC 4-3)。
   * @returns {object[]} Item配列(重複排除)
   */
  buildRetestQueue() {
    const s = this.session;
    let ids;
    if (s) {
      ids = [...new Set(s.stumbled)];
    } else if (this._lastSessionEnd) {
      ids = [...new Set(this._lastSessionEnd.stumbledIds)];
    } else {
      return [];
    }
    return ids.map((id) => this.itemsById.get(id)?.item).filter(Boolean);
  }

  /**
   * つまずいた項目だけで新しいセッションを開始する(SPEC 9.4の再テスト導線)。
   * 間隔条件(SPEC 4-5)が同一着席内で成立してしまわないよう、元セッションの
   * sessionStartedAt を引き継ぐ(新しい着席として扱わない)。
   * @returns {object}
   */
  startRetestSession() {
    const queue = this.buildRetestQueue();
    const inheritedStartedAt = this._lastSessionEnd?.sessionStartedAt ?? now();
    this.session = {
      mode: MODES.INPUT,
      moduleId: null,
      queue,
      index: 0,
      asked: 0,
      right: 0,
      wrong: 0,
      stumbled: [],
      themesMissed: new Set(),
      current: null,
      currentMode: MODES.INPUT,
      hintsUsed: [],
      knownAsWrong: false,
    };
    this.sessionStartedAt = inheritedStartedAt;
    this._advance();
    return this.getSessionView();
  }
}

// -----------------------------------------------------------------------
// ヒント表示用ユーティリティ
// -----------------------------------------------------------------------

/**
 * segmentをマスク表示する(文字数分の "_"、数字の語segmentなら "___"、桁segmentなら "_")。
 * @param {{text:string}} seg
 * @param {boolean} isNumbers
 * @param {boolean} [isDigitMode] - 数字入力モード(SPEC 8.3 モード2/3)の桁segmentかどうか
 * @returns {string}
 */
function maskSegment(seg, isNumbers, isDigitMode) {
  if (isNumbers) return isDigitMode ? "_" : "___";
  return seg.text
    .split("")
    .map((ch) => (ch === " " ? " " : "_"))
    .join("");
}

export { normalize, stripAccents, STORAGE_KEY };

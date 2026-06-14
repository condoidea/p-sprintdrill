// UI制御: 画面遷移・セッション進行・ヒント表示・設定 (SPEC 8.1 / 9)
import { DrillEngine, MODES } from "./engine.js";
import * as verbs from "./modules/verbs.js";
import { VERB_TYPES, A_PHRASES } from "./modules/verbs.js";
import * as numbers from "./modules/numbers.js";

const engine = new DrillEngine();

// 時制・人称の日本語ラベル(問題表示用)
const TENSE_LABELS = {
  pres: "現在",
  pret: "点過去",
  imperf: "線過去",
  fut: "未来",
  cond: "過去未来",
  subj: "接続法現在",
  imp_af: "命令(肯定)",
  imp_neg: "命令(否定)",
  participio: "過去分詞",
  perfecto: "現在完了",
  ger: "現在分詞",
  gustar: "gustar型",
};
const PERSON_LABELS = {
  yo: "yo",
  tu: "tú",
  el: "él/ella/usted",
  nosotros: "nosotros",
  vosotros: "vosotros",
  ellos: "ellos/ellas/ustedes",
  "-": "",
};

// 知識マップの行(時制・法)ラベル(動詞: TENSE_LABELSを再利用)
const VERB_TYPE_LABELS = Object.fromEntries(VERB_TYPES.map((t) => [t.key, t.label]));
const VERB_TYPE_ORDER = VERB_TYPES.map((t) => t.key);

// 数字ドリルのレベルラベル(知識マップ・問題表示用)
const NUMBER_LEVEL_LABELS = {
  1: "Lv1 (0〜15)",
  2: "Lv2 (16〜99)",
  3: "Lv3 (100〜999)",
  4: "Lv4 (1,000〜999,999)",
  5: "Lv5 (1,000,000)",
};

// -----------------------------------------------------------------------
// 数字ドリルの出題モード選択・読み上げ(SPEC 8.3)
// -----------------------------------------------------------------------

let selectedNumberMode = "spell";
let speechVoice = null; // es-ES の voice(無ければ null = 読み上げモード非表示)

/**
 * speechSynthesisで es-ES の voice を探す。見つからなければ読み上げモードを隠す。
 */
function initSpeechSupport() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    speechVoice = voices.find((v) => v.lang === "es-ES") || voices.find((v) => v.lang && v.lang.startsWith("es")) || null;
    const listenOption = document.getElementById("number-mode-listen-option");
    if (listenOption) listenOption.hidden = !speechVoice;
  };
  pickVoice();
  window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

/**
 * 数値を読み上げる(SPEC 8.3 モード3)。
 * @param {number} value
 * @param {number} rate - 0.7 | 1.0
 */
function speakSpanish(text, rate = 1.0) {
  if (typeof window === "undefined" || !window.speechSynthesis || !text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "es-ES";
  if (speechVoice) utter.voice = speechVoice;
  utter.rate = rate;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function speakNumber(value, rate) {
  speakSpanish(numbers.numToWords(value), rate);
}

// -----------------------------------------------------------------------
// 画面遷移
// -----------------------------------------------------------------------

const screens = {
  home: document.getElementById("screen-home"),
  session: document.getElementById("screen-session"),
  summary: document.getElementById("screen-summary"),
  settings: document.getElementById("screen-settings"),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

// -----------------------------------------------------------------------
// 初期化
// -----------------------------------------------------------------------

async function init() {
  try {
    await engine.loadData({ verbs, numbers });
  } catch (e) {
    // データ読み込み失敗時は無言で空画面にせず、原因を画面に出す(SPEC 1: 完全オフライン前提)
    showLoadError(e);
    return;
  }
  renderHome();
  showScreen("home");
  bindEvents();
  initSpeechSupport();
}

function showLoadError(err) {
  // index.html に用意済みの #load-error を使う(無ければ body に作る)
  const box = document.getElementById("load-error") || document.body.appendChild(document.createElement("div"));
  box.className = "card load-error";
  box.setAttribute("role", "alert");
  box.textContent = "";
  const h = document.createElement("h2");
  h.textContent = "データの読み込みに失敗しました";
  const p = document.createElement("p");
  p.textContent = err?.message ?? String(err);
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "ファイルを直接開いた場合はブラウザのセキュリティ制限が原因です。ローカルサーバ経由で開いてください。";
  box.append(h, p, hint);
  box.hidden = false;
}

// -----------------------------------------------------------------------
// ホーム画面(SPEC 9.1, 9.2)
// -----------------------------------------------------------------------

function renderHome() {
  // カウントダウン
  const days = engine.daysUntilExam();
  const countdownDays = document.getElementById("countdown-days");
  const countdownUnit = document.getElementById("countdown-unit");
  const countdownDateText = document.getElementById("countdown-date-text");
  const settings = engine.getSettings();

  if (days === null) {
    countdownDays.textContent = "--";
    countdownUnit.textContent = "";
    countdownDateText.textContent = "試験日が未設定です。設定画面で登録してください。";
  } else {
    countdownDays.textContent = String(days);
    countdownUnit.textContent = "日";
    if (days > 0) {
      countdownDateText.textContent = `試験日: ${engine.state.examDate}`;
    } else if (days === 0) {
      countdownDateText.textContent = "試験は今日です。";
    } else {
      countdownDateText.textContent = `試験日(${engine.state.examDate})は過ぎています。`;
    }
  }

  // 今日のノルマ
  const goal = engine.todaysGoal();
  const progress = engine.todaysProgress();
  document.getElementById("goal-target").textContent = String(goal);
  document.getElementById("goal-progress").textContent = String(progress);
  const pct = goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : 0;
  const fill = document.getElementById("goal-progress-fill");
  fill.style.width = `${pct}%`;
  document.getElementById("goal-progressbar").setAttribute("aria-valuenow", String(pct));

  // モジュールごとの習得状況
  for (const card of document.querySelectorAll(".module-card")) {
    const moduleId = card.dataset.module;
    const total = engine.totalCount(moduleId);
    const mastered = engine.masteredCount(moduleId);
    const learning = engine.learningCount(moduleId);
    card.querySelector('[data-stat="total"]').textContent = String(total);
    card.querySelector('[data-stat="mastered"]').textContent = String(mastered);
    card.querySelector('[data-stat="learning"]').textContent = String(learning);
  }

  // セッション問題数セレクタに現在の設定を反映
  document.getElementById("home-session-size").value = String(settings.sessionSize);

  renderKnowledgeMaps();
}

// -----------------------------------------------------------------------
// 知識マップ(SPEC 9.1, 11.4)
// -----------------------------------------------------------------------

/**
 * セルの習得状況(new/learning/mastered)から表示用クラス・テキストを組み立てる。
 * @param {{total:number, mastered:number, learning:number, new:number}} cell
 * @returns {{cls:string, text:string}}
 */
function knowledgeMapCellInfo(cell) {
  const total = cell.total ?? 0;
  if (total === 0) return { cls: "kmap-cell-empty", text: "" };
  const mastered = cell.mastered ?? 0;
  const learning = cell.learning ?? 0;
  const rate = total > 0 ? Math.round((mastered / total) * 100) : 0;
  // セル全体の色 = 習得率優先。全件習得済みなら緑、一部でも学習中/習得済みがあれば黄、それ以外(全て未学習)は灰
  let cls;
  if (mastered === total) cls = "kmap-cell-mastered";
  else if (mastered > 0 || learning > 0) cls = "kmap-cell-learning";
  else cls = "kmap-cell-new";
  return { cls, text: `${total}件 / ${rate}%` };
}

function renderKnowledgeMaps() {
  renderVerbKnowledgeMap();
  renderNumberKnowledgeMap();
}

/**
 * 動詞知識マップ(行=時制・法、列=動詞タイプ)をテーブルで描画する(SPEC 11.4)。
 */
function renderVerbKnowledgeMap() {
  const table = document.getElementById("verb-knowledge-map");
  const { rows, cols } = engine.verbKnowledgeMap();

  // 列の並び順: VERB_TYPE_ORDER優先、gustarは末尾
  const orderedCols = [...VERB_TYPE_ORDER.filter((c) => cols.includes(c)), ...cols.filter((c) => !VERB_TYPE_ORDER.includes(c))];

  const colLabel = (c) => (c === "gustar" ? "gustar型" : VERB_TYPE_LABELS[c] ?? c);
  const rowLabel = (r) => TENSE_LABELS[r] ?? r;

  let html = "<thead><tr><th></th>";
  for (const col of orderedCols) {
    html += `<th>${escapeHtml(colLabel(col))}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (const row of rows) {
    html += `<tr><th>${escapeHtml(rowLabel(row.key))}</th>`;
    for (const col of orderedCols) {
      const cell = row.cells[col];
      if (!cell) {
        html += `<td class="kmap-cell kmap-cell-empty"></td>`;
        continue;
      }
      const { cls, text } = knowledgeMapCellInfo(cell);
      html += `<td class="kmap-cell ${cls}">${escapeHtml(text)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  table.innerHTML = html;
}

/**
 * 数字知識マップ(レベル1〜5)をグリッドで描画する(SPEC 9.1)。
 */
function renderNumberKnowledgeMap() {
  const grid = document.getElementById("number-knowledge-map");
  const cells = engine.numberKnowledgeMap();

  grid.innerHTML = "";
  for (const cell of cells) {
    const { cls, text } = knowledgeMapCellInfo(cell);
    const div = document.createElement("div");
    div.className = `kmap-cell kmap-level-cell ${cls}`;
    const label = NUMBER_LEVEL_LABELS[cell.level] ?? `Lv${cell.level}`;
    div.innerHTML = `<span class="kmap-level-label">${escapeHtml(label)}</span><span class="kmap-level-stat">${escapeHtml(text)}</span>`;
    grid.appendChild(div);
  }
}

// -----------------------------------------------------------------------
// セッション画面(SPEC 8.1, 9.3)
// -----------------------------------------------------------------------

let currentHintDisplay = null; // requestHint()の最新結果を保持(再描画用)

function startSession(moduleId) {
  const size = parseInt(document.getElementById("home-session-size").value, 10);
  engine.startSession({ moduleId: moduleId || null, size, mode: MODES.MIXED, numberMode: selectedNumberMode });
  comboCount = 0;
  showScreen("session");
  renderQuestion();
}

function renderQuestion() {
  const view = engine.getSessionView();
  if (!view || view.finished) {
    finishSession();
    return;
  }

  currentHintDisplay = null;
  document.getElementById("hint-display").hidden = true;
  document.getElementById("hint-display").innerHTML = "";
  hideFeedbackModal();

  const item = view.item;
  document.getElementById("session-progress-current").textContent = String(view.asked + 1);
  document.getElementById("session-progress-total").textContent = String(view.total);
  const pct = view.total > 0 ? Math.round((view.asked / view.total) * 100) : 0;
  document.getElementById("session-progress-fill").style.width = `${pct}%`;

  const metaEl = document.getElementById("question-meta");
  const promptEl = document.getElementById("question-prompt");
  const jaEl = document.getElementById("question-ja");

  // 出題タイプ別の強調クラスをリセット(各render関数内で付け直す)
  document.getElementById("question-card").classList.remove("q-spec-hero", "q-gustar");

  if (item.moduleId === "verbs") {
    renderVerbQuestion(item, metaEl, promptEl, jaEl);
  } else {
    renderNumberQuestion(item, metaEl, promptEl, jaEl);
  }

  const input = document.getElementById("answer-input");
  input.value = "";
  input.disabled = false;
  document.getElementById("btn-submit-answer").disabled = false;
  document.getElementById("btn-hint").disabled = false;
  document.getElementById("btn-unknown").disabled = false;

  // 数字入力モード(SPEC 8.3 モード2/3)は数値キーボードを優先表示し、アクセントキーは不要
  const isDigitInput = item.moduleId === "numbers" && (item.payload.mode === "to_number" || item.payload.mode === "listen");
  input.inputMode = isDigitInput ? "numeric" : "text";
  input.placeholder = isDigitInput ? "数字で入力" : "スペイン語で入力";
  const accentKeys = document.getElementById("accent-keys");
  accentKeys.hidden = isDigitInput;

  // 4択モード(SPEC 8.2): 選択肢ボタンを表示し、入力欄は隠す
  const form = document.getElementById("answer-form");
  const choiceGrid = document.getElementById("choice-grid");
  if (view.mode === MODES.CHOICE) {
    form.hidden = true;
    accentKeys.hidden = true;
    choiceGrid.hidden = false;
    renderChoiceGrid(view.choices);
  } else {
    form.hidden = false;
    choiceGrid.hidden = true;
    choiceGrid.innerHTML = "";
    input.focus();
  }
}

function renderVerbQuestion(item, metaEl, promptEl, jaEl) {
  document.getElementById("listen-controls").hidden = true;
  const { inf, tense, person, ja, type, subject } = item.payload;
  if (type === "gustar") {
    // gustar型(SPEC 11.3): 変化させる動詞を主役に大きく見せ、文型を下に示す。
    const aPhrase = A_PHRASES[person] ?? "";
    document.getElementById("question-card").classList.add("q-gustar");
    metaEl.textContent = `${inf}（${ja}）`;
    promptEl.textContent = `(${aPhrase}) ___ ___ ${subject.es}`;
    jaEl.textContent = `「${subject.ja}」が主語。動詞は単複に合わせる`;
    return;
  }
  const tenseLabel = TENSE_LABELS[tense] ?? tense;
  const personLabel = PERSON_LABELS[person] ?? person;
  metaEl.textContent = personLabel ? `${inf} / ${tenseLabel} / ${personLabel}` : `${inf} / ${tenseLabel}`;
  promptEl.textContent = "正しい活用形を入力してください";
  jaEl.textContent = `日本語の意味: ${ja}`;
  // 活用指定(meta)を主役、指示文(prompt)をやや小さく
  document.getElementById("question-card").classList.add("q-spec-hero");
}

function renderNumberQuestion(item, metaEl, promptEl, jaEl) {
  const { value, level, mode } = item.payload;
  const levelLabel = NUMBER_LEVEL_LABELS[level] ?? `レベル${level}`;
  const listenControls = document.getElementById("listen-controls");

  if (mode === "to_number") {
    // モード2: 綴り→数字入力
    listenControls.hidden = true;
    metaEl.textContent = `数字ドリル / ${levelLabel} / 綴り→数字`;
    promptEl.textContent = numbers.spellingFor(item);
    jaEl.textContent = "この綴りが表す数値を入力してください";
  } else if (mode === "listen") {
    // モード3: 読み上げ→数字入力
    listenControls.hidden = false;
    metaEl.textContent = `数字ドリル / ${levelLabel} / 読み上げ→数字`;
    promptEl.textContent = "🔊";
    jaEl.textContent = "音声を聞いて、その数値を入力してください";
    currentListenValue = value;
    playListenAudio();
  } else {
    // モード1(既定): 数字→綴り
    listenControls.hidden = true;
    metaEl.textContent = `数字ドリル / ${levelLabel} / 数字→綴り`;
    promptEl.textContent = formatNumber(value);
    jaEl.textContent = "この数値をスペイン語の綴りで入力してください";
  }
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

// --- 読み上げモード(SPEC 8.3 モード3) -------------------------------------

let currentListenValue = null;

function playListenAudio() {
  if (currentListenValue == null) return;
  const rate = parseFloat(document.querySelector('input[name="listen-speed"]:checked')?.value ?? "0.7");
  speakNumber(currentListenValue, rate);
}

// --- 4択モード(SPEC 8.2) ---------------------------------------------------

/**
 * 4択の選択肢ボタンを描画する。
 * @param {string[]} choices
 */
function renderChoiceGrid(choices) {
  const grid = document.getElementById("choice-grid");
  grid.innerHTML = "";
  choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-choice";
    btn.dataset.choiceIndex = String(i);
    btn.innerHTML = `<span class="choice-number">${i + 1}</span><span class="choice-text">${escapeHtml(choice)}</span>`;
    btn.addEventListener("click", () => handleChoiceSelect(choice));
    grid.appendChild(btn);
  });
}

function handleChoiceSelect(choiceText) {
  const grid = document.getElementById("choice-grid");
  if (grid.querySelector(".btn-choice:disabled")) return; // 連打防止
  for (const btn of grid.querySelectorAll(".btn-choice")) {
    btn.disabled = true;
  }
  const result = engine.submitAnswer(choiceText);
  showFeedback(result, choiceText);
}

// --- ヒント機構(SPEC 5) ---------------------------------------------------

function onHintRequest() {
  const result = engine.requestHint();
  if (!result) return;

  if (result.treatAsUnknown) {
    // 最終段階を超えた要求 = 「わからない」と同じ扱い
    handleUnknown();
    return;
  }

  currentHintDisplay = result.hint;
  const hintEl = document.getElementById("hint-display");
  hintEl.hidden = false;
  hintEl.innerHTML = renderHintHtml(result.hint);

  // ヒント段数の上限に達していたらボタンの文言を変える
  const view = engine.getSessionView();
  if (result.stage >= view.maxHintStage) {
    document.getElementById("btn-hint").textContent = "もうわからない";
  }
}

function renderHintHtml(hint) {
  const stageLabel = { 1: "ヒント1", 2: "ヒント2", 3: "ヒント3" }[hint.stage] ?? "ヒント";
  let body;
  if (hint.type === "word-count") {
    const unit = hint.unit ?? "語";
    body = `<span class="hint-display-text">${escapeHtml(hint.display)}</span><span class="hint-sub">(${hint.wordCount}${unit})</span>`;
  } else if (hint.type === "char-count") {
    // 寛容モードONの場合、アクセント付き文字のマスは "Á" で示される(SPEC 5)。
    // マスごとにspanで囲み、"Á" のマスだけ強調表示する。
    body = `<span class="hint-display-text">${renderCharCountDisplay(hint.display)}</span>`;
  } else {
    body = `<span class="hint-display-text">${escapeHtml(hint.display)}</span>`;
  }
  return `<span class="hint-label">${stageLabel}</span> ${body}`;
}

/**
 * char-countヒントのdisplay文字列(スペース区切りのマス)をspan単位で組み立てる。
 * "Á" のマスは寛容モードでのアクセント位置強調(SPEC 5)としてCSSで装飾する。
 * @param {string} display
 * @returns {string}
 */
function renderCharCountDisplay(display) {
  return display
    .split(" ")
    .map((cell) => {
      if (cell === "Á") return `<span class="hint-cell hint-cell-accent">Á</span>`;
      return `<span class="hint-cell">${escapeHtml(cell)}</span>`;
    })
    .join(" ");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- 解答送信・「わからない」 -----------------------------------------------

function handleSubmit() {
  const input = document.getElementById("answer-input");
  const value = input.value;
  if (value.trim() === "") {
    input.focus();
    return;
  }
  const result = engine.submitAnswer(value);
  showFeedback(result, value);
}

function handleUnknown() {
  const result = engine.submitUnknown();
  showFeedback(result, null); // 「わからない」は入力なし → 差分表示しない
}

let comboCount = 0; // 連続ノーヒント正解数

function showFeedback(result, submittedInput) {
  // 入力・補助ボタンを無効化(連打防止)
  document.getElementById("btn-submit-answer").disabled = true;
  document.getElementById("btn-hint").disabled = true;
  document.getElementById("btn-unknown").disabled = true;
  document.getElementById("btn-hint").textContent = "ヒント";
  for (const btn of document.querySelectorAll("#choice-grid .btn-choice")) {
    btn.disabled = true;
  }

  // ノーヒントの完全正解のみコンボ加算。それ以外(誤答/△/ヒント使用/わからない)はリセット。
  const clean = result.result === "correct" && !result.assisted;
  if (clean) comboCount += 1;
  else comboCount = 0;

  // 全パターンでモーダル表示(解説を全画面で読めるようキーボードは閉じる)
  document.getElementById("answer-input").disabled = true;
  document.getElementById("answer-input").blur();
  showFeedbackModal(result, clean, submittedInput);

  // ノーヒント正解はモーダルに正解演出(コンボ・紙吹雪)を重ねる
  if (clean) celebrateCorrect(comboCount);
}

function showFeedbackModal(result, clean, submittedInput) {
  const overlay = document.getElementById("feedback-overlay");
  const sheet = document.getElementById("feedback-card");
  const resultEl = document.getElementById("feedback-result");
  const correctEl = document.getElementById("feedback-correct");
  const diffEl = document.getElementById("feedback-diff");
  const explanationEl = document.getElementById("feedback-explanation");
  const noteEl = document.getElementById("feedback-note");

  sheet.classList.remove("feedback-correct-state", "feedback-partial-state", "feedback-wrong-state");
  diffEl.hidden = true;
  diffEl.innerHTML = "";

  // 不正解・半正解で入力がある場合は、入力と正解を文字単位で並べて差分表示する
  const showDiff = (result.result === "wrong" || result.result === "partial") && submittedInput != null;

  if (result.result === "correct") {
    sheet.classList.add("feedback-correct-state");
    resultEl.textContent = result.assisted ? "○ 正解(ヒント使用)" : "○ 正解";
    correctEl.textContent = result.correctText;
    explanationEl.textContent = "";
    noteEl.hidden = !result.requeue;
  } else if (result.result === "partial") {
    sheet.classList.add("feedback-partial-state");
    resultEl.textContent = "△ 半正解(アクセント記号に注意)";
    explanationEl.textContent = result.explanation ?? "";
    noteEl.hidden = false;
  } else {
    sheet.classList.add("feedback-wrong-state");
    resultEl.textContent = result.result === "unknown" ? "✕ わからない" : "✕ 不正解";
    explanationEl.textContent = result.explanation ?? "";
    noteEl.hidden = false;
  }

  if (showDiff) {
    // 差分表示時は重複する「正解: 〜」テキストは出さず(発音ボタンは残す)、差分の正解行に集約
    correctEl.textContent = "";
    diffEl.innerHTML = renderDiffHtml(submittedInput, result.correctText);
    diffEl.hidden = false;
  } else if (result.result !== "correct") {
    correctEl.textContent = `正解: ${result.correctText}`;
  }

  setupSpeakButton(result.correctText);

  overlay.hidden = false;
  sheet.scrollTop = 0;
  // ダイアログ本体にフォーカス(Enterはdocumentのkeydownで進行。ボタン直接フォーカスだと二重発火するため避ける)
  requestAnimationFrame(() => sheet.focus());
}

// --- 入力と正解の文字単位差分(SPEC 7.1の判定に合わせる) ----------------------

/** 判定と同じ正規化(前後空白除去 + 小文字化 + 連続空白の圧縮)。アクセントは保持。 */
function normalizeForDiff(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 入力文字列と正解文字列を編集距離(Levenshtein)で整列し、列ごとの対応を返す。
 * @returns {{type:'same'|'diff'|'missing'|'extra', a:string, b:string}[]}
 *   a=正解側の文字, b=入力側の文字('missing'は入力欠落, 'extra'は入力余分)
 */
function alignStrings(correct, input) {
  const a = [...correct]; // 正解
  const b = [...input];   // 入力
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  // バックトレースで列を復元
  const cols = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      cols.push({ type: "same", a: a[i - 1], b: b[j - 1] }); i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      cols.push({ type: "diff", a: a[i - 1], b: b[j - 1] }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      cols.push({ type: "missing", a: a[i - 1], b: "" }); i--; // 入力に欠落
    } else {
      cols.push({ type: "extra", a: "", b: b[j - 1] }); j--; // 入力に余分
    }
  }
  cols.reverse();
  return cols;
}

/** 整列結果を2行(入力/正解)のHTMLにする。差異セルを色分けし、欠落/余分はギャップ表示。 */
function renderDiffHtml(rawInput, rawCorrect) {
  const correct = normalizeForDiff(rawCorrect);
  const input = normalizeForDiff(rawInput);
  const cols = alignStrings(correct, input);

  // 入力が正解とかけ離れている(一致文字が少ない)場合、文字整列は散らばって見づらい。
  // その場合は文字単位の整列をやめ、シンプルな2行表示にフォールバックする。
  const sameCount = cols.filter((c) => c.type === "same").length;
  const denom = Math.max([...correct].length, [...input].length, 1);
  if (sameCount / denom < 0.4) {
    return (
      `<div class="diff-line diff-plain"><span class="diff-label">あなた</span><span class="diff-chars dc-bad-plain">${escapeHtml(input) || "(空欄)"}</span></div>` +
      `<div class="diff-line diff-plain"><span class="diff-label">正解</span><span class="diff-chars dc-good-plain">${escapeHtml(correct)}</span></div>`
    );
  }

  const GAP = "·";
  const cell = (ch, cls) => `<span class="dc ${cls}">${ch === " " ? "&nbsp;" : escapeHtml(ch)}</span>`;

  const inputRow = cols.map((c) => {
    if (c.type === "same") return cell(c.b, "dc-same");
    if (c.type === "diff") return cell(c.b, "dc-bad");
    if (c.type === "extra") return cell(c.b, "dc-bad");      // 余分に入れた文字
    return cell(GAP, "dc-gap");                               // missing: 入力に欠落
  }).join("");

  const correctRow = cols.map((c) => {
    if (c.type === "same") return cell(c.a, "dc-same");
    if (c.type === "diff") return cell(c.a, "dc-good");
    if (c.type === "missing") return cell(c.a, "dc-good");   // 本来必要だった文字
    return cell(GAP, "dc-gap");                               // extra: 正解側は空
  }).join("");

  return (
    `<div class="diff-line"><span class="diff-label">あなた</span><span class="diff-chars">${inputRow}</span></div>` +
    `<div class="diff-line"><span class="diff-label">正解</span><span class="diff-chars">${correctRow}</span></div>`
  );
}

/**
 * 正解表示のスピーカーボタンを設定する。
 * 発音対象は動詞の活用形と数字の綴りモードのみ(数字入力モードや音声未対応端末では非表示)。
 * @param {string} correctText
 */
function setupSpeakButton(correctText) {
  const btn = document.getElementById("btn-speak");
  const item = engine.getSessionView()?.item;
  let speakText = null;
  if (item && correctText) {
    if (item.moduleId === "verbs") speakText = correctText;
    else if (item.moduleId === "numbers" && item.payload.mode === "spell") speakText = correctText;
  }

  if (speakText && speechVoice) {
    btn.hidden = false;
    btn.onclick = () => speakSpanish(speakText, 1.0);
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
}

function hideFeedbackModal() {
  const overlay = document.getElementById("feedback-overlay");
  if (overlay) overlay.hidden = true;
}

/**
 * 正解演出(SPEC外のUX強化)。連続正解でやや豪華にする。
 * @param {number} streak 現在のコンボ数
 */
function celebrateCorrect(streak) {
  const card = document.getElementById("question-card");
  card.classList.remove("flash-correct");
  void card.offsetWidth; // リフロー強制でアニメーション再生
  card.classList.add("flash-correct");

  const layer = document.getElementById("celebrate-layer");
  if (!layer) return;
  layer.innerHTML = "";

  const hot = streak >= 5;

  // 中央のチェックリング
  const ring = document.createElement("div");
  ring.className = "celebrate-ring" + (hot ? " tier-hot" : "");
  ring.textContent = streak >= 8 ? "🔥" : "✓";
  layer.appendChild(ring);

  // コンボ表示(2連以上)
  if (streak >= 2) {
    const badge = document.createElement("div");
    badge.className = "combo-badge" + (hot ? " tier-hot" : "");
    const label = streak >= 8 ? "ON FIRE!" : streak >= 5 ? "ナイス連続!" : "コンボ";
    badge.innerHTML = `<span class="combo-x">×${streak}</span><span class="combo-label">${label}</span>`;
    layer.appendChild(badge);
  }

  // 紙吹雪(コンボに応じて数と広がりを増やす)
  if (!prefersReducedMotion()) {
    const count = Math.min(8 + streak * 4, 48);
    const spread = Math.min(120 + streak * 18, 320);
    const colors = hot
      ? ["#e8a32c", "#d8642a", "#f2c14e", "#c2541f"]
      : ["#3d6b5c", "#2f7a4f", "#8bc6a3", "#e8a32c"];
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "celebrate-particle";
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = spread * (0.5 + Math.random() * 0.5);
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--p-x", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--p-y", `${Math.sin(angle) * dist - 40}px`);
      p.style.setProperty("--p-rot", `${Math.random() * 720 - 360}deg`);
      p.style.setProperty("--p-dur", `${0.7 + Math.random() * 0.5}s`);
      layer.appendChild(p);
    }
  }

  // 1.3秒後にレイヤーを掃除(自動進行より長めに残しても次問描画で消える)
  setTimeout(() => { if (layer) layer.innerHTML = ""; }, 1400);
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function handleNextQuestion() {
  if (window.speechSynthesis) window.speechSynthesis.cancel(); // 発音再生中なら止める
  const layer = document.getElementById("celebrate-layer");
  if (layer) layer.innerHTML = "";
  engine.nextQuestion();
  renderQuestion();
}

function finishSession() {
  const summary = engine.endSession();
  renderSummary(summary);
  showScreen("summary");
}

// -----------------------------------------------------------------------
// セッションサマリ画面(SPEC 9.4)
// -----------------------------------------------------------------------

const THEME_LABELS = {
  "verbs:pres": "動詞: 直説法現在",
  "verbs:pret": "動詞: 点過去",
  "verbs:imperf": "動詞: 線過去",
  "verbs:fut": "動詞: 未来",
  "verbs:cond": "動詞: 過去未来",
  "verbs:subj": "動詞: 接続法現在",
  "verbs:gustar": "動詞: gustar型",
  "numbers:L1": "数字: レベル1(0〜15)",
  "numbers:L2": "数字: レベル2(16〜99)",
  "numbers:L3": "数字: レベル3(100〜999)",
  "numbers:L4": "数字: レベル4(1,000〜999,999)",
  "numbers:L5": "数字: レベル5(1,000,000)",
};

let lastSummary = null;

function renderSummary(summary) {
  lastSummary = summary;
  const rate = summary.asked > 0 ? Math.round((summary.right / summary.asked) * 100) : 0;
  document.getElementById("summary-rate").textContent = `${rate}%`;
  document.getElementById("summary-asked").textContent = String(summary.asked);
  document.getElementById("summary-right").textContent = String(summary.right);
  document.getElementById("summary-wrong").textContent = String(summary.wrong);

  const listEl = document.getElementById("summary-theme-list");
  listEl.innerHTML = "";
  const themesCard = document.getElementById("summary-themes-card");
  if (summary.themesMissed.length === 0) {
    themesCard.hidden = true;
  } else {
    themesCard.hidden = false;
    for (const theme of summary.themesMissed) {
      const li = document.createElement("li");
      li.textContent = THEME_LABELS[theme] ?? theme;
      listEl.appendChild(li);
    }
  }

  const retestBtn = document.getElementById("btn-retest");
  retestBtn.hidden = summary.stumbledIds.length === 0;
}

function handleRetest() {
  if (!lastSummary || lastSummary.stumbledIds.length === 0) return;
  engine.startRetestSession();
  showScreen("session");
  renderQuestion();
}

// -----------------------------------------------------------------------
// 設定画面(SPEC 9.5)
// -----------------------------------------------------------------------

function renderSettings() {
  const settings = engine.getSettings();
  document.getElementById("setting-exam-date").value = engine.state.examDate ?? "";
  document.getElementById("setting-lenient").checked = !!settings.lenientAccent;
  document.getElementById("setting-session-size").value = String(settings.sessionSize);
  document.getElementById("setting-exclude-vosotros").checked = !!settings.excludeVosotros;
  document.getElementById("setting-choice-ratio").value = String(settings.choiceRatio);
  document.getElementById("setting-require-input-mastery").checked = !!settings.requireInputForMastery;
  document.getElementById("reset-confirm-row").hidden = true;
}

function bindSettingsEvents() {
  document.getElementById("setting-exam-date").addEventListener("change", (e) => {
    engine.setExamDate(e.target.value || null);
    renderHome();
  });
  document.getElementById("setting-lenient").addEventListener("change", (e) => {
    engine.updateSettings({ lenientAccent: e.target.checked });
  });
  document.getElementById("setting-session-size").addEventListener("change", (e) => {
    engine.updateSettings({ sessionSize: parseInt(e.target.value, 10) });
    renderHome();
  });
  document.getElementById("setting-exclude-vosotros").addEventListener("change", (e) => {
    engine.updateSettings({ excludeVosotros: e.target.checked });
  });
  document.getElementById("setting-choice-ratio").addEventListener("change", (e) => {
    engine.updateSettings({ choiceRatio: parseFloat(e.target.value) });
  });
  document.getElementById("setting-require-input-mastery").addEventListener("change", (e) => {
    engine.updateSettings({ requireInputForMastery: e.target.checked });
  });

  document.getElementById("btn-reset-data").addEventListener("click", () => {
    document.getElementById("reset-confirm-row").hidden = false;
  });
  document.getElementById("btn-reset-cancel").addEventListener("click", () => {
    document.getElementById("reset-confirm-row").hidden = true;
  });
  document.getElementById("btn-reset-confirm").addEventListener("click", () => {
    engine.resetAllData();
    renderSettings();
    renderHome();
    document.getElementById("reset-confirm-row").hidden = true;
  });
}

// -----------------------------------------------------------------------
// イベント結線
// -----------------------------------------------------------------------

function bindEvents() {
  // ホーム
  for (const btn of document.querySelectorAll(".btn-start-session")) {
    btn.addEventListener("click", () => startSession(btn.dataset.module));
  }
  document.getElementById("btn-open-settings").addEventListener("click", () => {
    renderSettings();
    showScreen("settings");
  });

  // 数字ドリルの出題モード選択(SPEC 8.3)
  for (const radio of document.querySelectorAll('input[name="number-mode"]')) {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) selectedNumberMode = e.target.value;
    });
  }

  // セッション
  document.getElementById("answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleSubmit();
  });
  document.getElementById("btn-hint").addEventListener("click", onHintRequest);
  document.getElementById("btn-unknown").addEventListener("click", handleUnknown);
  document.getElementById("btn-next-question").addEventListener("click", handleNextQuestion);
  document.getElementById("btn-quit-session").addEventListener("click", () => {
    if (confirm("セッションを中断してホームに戻りますか?(この問題までの記録は保存されます)")) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      hideFeedbackModal();
      const layer = document.getElementById("celebrate-layer");
      if (layer) layer.innerHTML = "";
      engine.endSession();
      showScreen("home");
      renderHome();
    }
  });

  // アクセントソフトキー: 入力欄のカーソル位置に文字を挿入
  for (const key of document.querySelectorAll(".accent-key")) {
    key.addEventListener("click", () => {
      insertAtCursor(document.getElementById("answer-input"), key.dataset.char);
    });
  }

  // 読み上げモード(SPEC 8.3 モード3): 再生ボタン・速度切替
  document.getElementById("btn-listen-play").addEventListener("click", playListenAudio);

  // キーボード操作(SPEC 14-5): Enterで次の問題へ、4択は1-4キーで選択
  document.addEventListener("keydown", (e) => {
    if (screens.session.hidden) return;
    const modalVisible = !document.getElementById("feedback-overlay").hidden;

    // モーダル表示中のEnter → 次へ(入力欄はblur済みなのでform submitとは競合しない)
    if (e.key === "Enter" && modalVisible) {
      e.preventDefault();
      handleNextQuestion();
      return;
    }

    if (!modalVisible && !document.getElementById("choice-grid").hidden && /^[1-4]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const btn = document.querySelector(`#choice-grid .btn-choice[data-choice-index="${idx}"]`);
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    }
  });

  // サマリ
  document.getElementById("btn-retest").addEventListener("click", handleRetest);
  document.getElementById("btn-back-home").addEventListener("click", () => {
    showScreen("home");
    renderHome();
  });

  // 設定
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    showScreen("home");
    renderHome();
  });
  bindSettingsEvents();
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = before + text + after;
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.focus();
}

init();

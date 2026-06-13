// 数字モジュール: 0〜1,000,000の number-to-words + ドリル用 ModuleInterface 実装
// データファイルは fetch せず init(data) で注入を受ける(Node/ブラウザ両対応)

let DATA = null;

/**
 * numbers.json を注入する。
 * @param {object} data - data/numbers.json の内容
 */
export function init(data) {
  DATA = data;
}

// --- number-to-words ---------------------------------------------------

const UNITS_0_15 = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince",
];
const TEENS_16_19 = ["dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = [
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];
const TENS = { 3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa" };
// 不規則百位(500/700/900)。それ以外は基数+cientos
const HUNDREDS_IRREGULAR = { 5: "quinientos", 7: "setecientos", 9: "novecientos" };

/**
 * 0〜99 を綴りに変換する。
 * @param {number} n
 * @param {{gender?: "m"|"f"}} opts
 */
function under100(n, opts) {
  const gender = (opts && opts.gender) || "m";
  if (n <= 15) {
    if (n === 1) return gender === "f" ? "una" : "uno";
    return UNITS_0_15[n];
  }
  if (n <= 19) return TEENS_16_19[n - 16];
  if (n <= 29) {
    if (n === 20) return "veinte";
    if (n === 21) return gender === "f" ? "veintiuna" : "veintiuno";
    return TWENTIES[n - 20];
  }
  const tens = Math.floor(n / 10);
  const units = n % 10;
  const tensWord = TENS[tens];
  if (units === 0) return tensWord;
  const unitsWord = units === 1 ? (gender === "f" ? "una" : "uno") : UNITS_0_15[units];
  return `${tensWord} y ${unitsWord}`;
}

/**
 * 0〜999 を綴りに変換する。
 * @param {number} n
 * @param {{gender?: "m"|"f"}} opts
 */
function under1000(n, opts) {
  const gender = (opts && opts.gender) || "m";
  if (n < 100) return under100(n, opts);
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let hWord;
  if (HUNDREDS_IRREGULAR[h]) {
    hWord = HUNDREDS_IRREGULAR[h];
    if (gender === "f") hWord = hWord.slice(0, -2) + "as"; // quinientos -> quinientas
  } else if (h === 1) {
    hWord = "ciento"; // 101〜199
  } else {
    hWord = UNITS_0_15[h] + "cientos"; // doscientos, trescientos...
    if (gender === "f") hWord = hWord.slice(0, -2) + "as";
  }
  if (rest === 0) return hWord;
  return `${hWord} ${under100(rest, opts)}`;
}

/**
 * 1〜999 を「mil の前」用に変換する(uno→un の脱落を適用)。
 * @param {number} n
 * @param {{gender?: "m"|"f"}} opts
 */
function thousandsMultiplier(n, opts) {
  const gender = (opts && opts.gender) || "m";
  if (n === 1) return ""; // 1000 = mil (un mil とは言わない)
  let word = under1000(n, opts);
  // 末尾の uno/una -> un/una (mil の前で母音脱落するのは男性のみ。女性は una のまま)
  if (gender !== "f") {
    if (word.endsWith("uno")) word = word.slice(0, -1); // veintiuno -> veintiún (アクセント付与は下の特殊処理)
  }
  // veintiún / treinta y un など、語末が "un" になる場合はアクセントを補う必要があるケース(veintiún)
  if (word.endsWith("un") && !word.endsWith("gun")) {
    if (word === "veintiun") word = "veintiún";
  }
  return word;
}

/**
 * 0〜1,000,000 を綴りに変換する。
 * @param {number} n - 0以上1,000,000以下の整数
 * @param {{gender?: "m"|"f"}} [opts]
 * @returns {string}
 */
export function numToWords(n, opts) {
  const gender = (opts && opts.gender) || "m";
  if (!Number.isInteger(n) || n < 0 || n > 1000000) {
    throw new RangeError(`numToWords: out of range (0-1,000,000): ${n}`);
  }
  if (n === 0) return "cero";
  if (n < 1000) return under1000(n, opts);
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    let head;
    if (thousands === 1) {
      head = "mil";
    } else {
      const multWord = thousandsMultiplier(thousands, opts);
      head = `${multWord} mil`;
    }
    if (rest === 0) return head;
    return `${head} ${under1000(rest, opts)}`;
  }
  // n === 1000000
  return "un millón";
}

// --- ドリル用 ModuleInterface ------------------------------------------

const MODULE_ID = "numbers";

/**
 * 数値を語単位 segments に分割する。critical = ルール発火に関わる急所語。
 * @param {number} n
 * @returns {{text: string, role: string, critical: boolean}[]}
 */
function buildSegments(n) {
  const full = numToWords(n);
  const words = full.split(" ");
  return words.map((w) => {
    const stripped = stripAccents(w);
    let critical = false;
    // アクセント付き語(dieciséis等)、cien/ciento、不規則百位、mil/millón、un(脱落形)はクリティカル
    if (stripped !== w) critical = true; // アクセントを含む語
    if (/^(cien|ciento)$/.test(w)) critical = true;
    if (/^(quinientos|setecientos|novecientos|quinientas|setecientas|novecientas)$/.test(w)) critical = true;
    if (/^(mil|millón|millones)$/.test(w)) critical = true;
    if (/^(veintiún|un)$/.test(w) && words[words.indexOf(w) + 1] === "mil") critical = true;
    return { text: w, role: "word", critical };
  });
}

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * レベルに対応する範囲・tier情報を取得する。
 */
function levelFor(value) {
  for (const lv of DATA.levels) {
    const [lo, hi] = lv.range;
    if (value >= lo && value <= hi) return lv;
  }
  return DATA.levels[DATA.levels.length - 1];
}

/**
 * 各レベルの「急所を踏む数」(hot pattern)を具体的な数値リストとして生成する。
 */
function hotNumbersFor(lv) {
  switch (lv.lv) {
    case 1:
      return Array.from({ length: 16 }, (_, i) => i); // 0-15全部
    case 2: {
      const nums = [];
      for (let i = 16; i <= 19; i++) nums.push(i); // 16-19
      for (let i = 21; i <= 29; i++) nums.push(i); // 21-29
      for (let t = 3; t <= 9; t++) nums.push(t * 10 + 1); // x1
      for (let t = 3; t <= 9; t++) nums.push(t * 10 + 6); // x6
      return nums;
    }
    case 3: {
      const nums = [100, 101, 110];
      for (let i = 102; i <= 109; i++) nums.push(i); // 101-110付近
      for (const h of [1, 2, 3, 4, 5, 6, 7, 8, 9]) nums.push(h * 100); // x00
      for (const h of [5, 7, 9]) {
        nums.push(h * 100 + 1, h * 100 + 50, h * 100 + 99); // 5xx/7xx/9xx
      }
      return nums;
    }
    case 4: {
      const nums = [1000, 100000, 21000, 31000, 101000, 1996, 2026];
      for (const h of [5, 7, 9]) nums.push(h * 100 * 1000 + 500); // mil+5xx等の複合(簡易)
      nums.push(15000, 999999);
      return nums;
    }
    case 5:
      return [1000000];
    default:
      return [];
  }
}

/**
 * 決定的な擬似乱数生成器(LCG)。同じシードからは常に同じ数列を返す。
 * リロードごとに項目IDが変わって既存の進捗レコードが孤児化する(P0-4)のを防ぐため、
 * Math.random ではなく固定シードの擬似乱数を使う。
 * @param {number} seed
 * @returns {() => number} 0以上1未満の擬似乱数を返す関数
 */
function createSeededRng(seed) {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * レベル範囲内の「cold」(急所非発火寄り)な数を、固定シードの擬似乱数で決定的に生成する。
 * @param {object} lv
 * @param {number} count
 * @returns {number[]}
 */
function coldNumbersFor(lv, count) {
  const [lo, hi] = lv.range;
  // レベルごとに固定のシードを使う(ロードごとに同じ列を生成する)
  const rng = createSeededRng(1000 + lv.lv);
  const nums = [];
  for (let i = 0; i < count; i++) {
    nums.push(lo + Math.floor(rng() * (hi - lo + 1)));
  }
  return nums;
}

/**
 * 学習項目を全列挙する。
 * sampling_weights に基づき、レベルごとに hot:cold ≒ 7:3 で数値を選ぶ。
 * cold数は固定シードの擬似乱数で決定的に生成する(リロードでIDが変わらないようにする)。
 * @returns {Array}
 */
export function generateItems() {
  const items = [];
  for (const lv of DATA.levels) {
    const hot = hotNumbersFor(lv);
    const coldCount = Math.max(1, Math.round(hot.length * (3 / 7)));
    const cold = coldNumbersFor(lv, coldCount);
    const values = [...new Set([...hot, ...cold])];
    for (const value of values) {
      items.push({
        id: `numbers:L${lv.lv}:${value}`,
        moduleId: MODULE_ID,
        payload: { value, level: lv.lv, mode: "spell" },
        tier: lv.tier,
      });
    }
  }
  return items;
}

/**
 * 数値を桁単位 segments に分割する(SPEC 8.3 モード2/3: 数字入力の正解構造)。
 * 全桁をcriticalとする(ヒントH1=桁数のマス、H3=先頭桁の開示)。
 * @param {number} n
 * @returns {{text: string, role: string, critical: boolean}[]}
 */
function buildDigitSegments(n) {
  return String(n).split("").map((d) => ({ text: d, role: "digit", critical: true }));
}

/**
 * 正解を生成する。
 * payload.mode が "to_number"(綴り→数字) / "listen"(読み上げ→数字) の場合は
 * 数字そのものを正解とする(SPEC 8.3)。既定("spell")は綴りが正解(従来通り)。
 * @param {object} item
 * @returns {{text: string, segments: Array}}
 */
export function answerFor(item) {
  const { value, gender, mode } = item.payload;
  if (mode === "to_number" || mode === "listen") {
    return { text: String(value), segments: buildDigitSegments(value) };
  }
  const text = numToWords(value, gender ? { gender } : undefined);
  const segments = buildSegments(value);
  return { text, segments };
}

/**
 * 出題文に表示する綴り(SPEC 8.3 モード2/3: 「綴り→数字」「読み上げ→数字」の問題文用)。
 * @param {object} item
 * @returns {string}
 */
export function spellingFor(item) {
  const { value, gender } = item.payload;
  return numToWords(value, gender ? { gender } : undefined);
}

/**
 * ヒント段階制御用の急所(critical)定義。critical segmentsのindex配列を返す。
 */
export function criticalZone(item, answer) {
  const criticalIndexes = [];
  answer.segments.forEach((seg, i) => {
    if (seg.critical) criticalIndexes.push(i);
  });
  return { criticalIndexes, segments: answer.segments };
}

/**
 * 誤答を分類する(SPEC 7.3 ErrorTag)。
 * @param {object} item
 * @param {string} input
 * @param {{text: string}} answer
 * @returns {string[]}
 */
export function classifyError(item, input, answer) {
  const tags = [];
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const a = norm(answer.text);
  const u = norm(input);
  const { value, mode } = item.payload;

  if (a === u) return tags; // 正解(呼び出し側で正誤判定済みの想定だが念のため)

  if (mode === "to_number" || mode === "listen") {
    // モード2/3(数字入力)はスペイン語の綴り規則ではなく数値の取り違え。汎用タグのみ。
    return ["other"];
  }

  // accent_missing: アクセント除去後に一致
  if (stripAccents(a) === stripAccents(u)) {
    tags.push("accent_missing");
    return tags;
  }

  // cien_ciento: ちょうど100=cien か 101-199=ciento の取り違え
  if (value === 100 && /\bciento\b/.test(u) && /\bcien\b/.test(a)) {
    tags.push("cien_ciento");
  }
  if (value >= 101 && value <= 199 && /\bcien\b/.test(u) && /\bciento\b/.test(a)) {
    tags.push("cien_ciento");
  }

  // irregular_hundreds: 500/700/900 の規則化誤り(cincocientos等)
  const hundredsDigit = Math.floor((value % 1000) / 100);
  if ([5, 7, 9].includes(hundredsDigit)) {
    const regularized = UNITS_0_15[hundredsDigit] + "cientos";
    if (u.includes(regularized) || u.includes(regularized.replace(/os$/, "as"))) {
      tags.push("irregular_hundreds");
    }
  }

  // y_misuse: y の位置誤り(ciento y uno 型 / treinta y uno で y を省略した型)
  if (/ciento y/.test(u) || (/\d|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa/.test(a) && / y /.test(a) && !/ y /.test(u) && /[a-z]+(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|una)$/.test(u))) {
    if (!tags.includes("y_misuse")) tags.push("y_misuse");
  }

  // mil_un: 1000 を "un mil" としてしまう / cien mil を ciento mil 等
  if (value === 1000 && /\bun mil\b/.test(u)) tags.push("mil_un");
  if (value === 100000 && /\bciento mil\b/.test(u)) tags.push("mil_un");

  // millon_form: 1,000,000 を millón のみ(un抜け)、複数形誤りなど
  if (value === 1000000 && (/^millón$/.test(u) || /millones/.test(u))) tags.push("millon_form");
  if (value >= 2000000 && /\bmillón\b/.test(u)) tags.push("millon_form");

  // fusion_split: 16-29を分かち書き、または31以上を一語化
  if (value >= 16 && value <= 29) {
    if (u.includes(" ") || u.includes("y")) tags.push("fusion_split");
  }
  if (value >= 31 && value % 10 !== 0) {
    const onepieceCandidate = a.replace(" y ", "");
    if (u === onepieceCandidate) tags.push("fusion_split");
  }

  if (tags.length === 0) tags.push("other");
  return tags;
}

/**
 * ErrorTag からミニ解説文を生成する(data/explanations.json を利用)。
 * @param {string[]} errorTags
 * @param {object} item
 * @param {object} explanations - data/explanations.json の内容
 * @returns {string}
 */
export function explanationFor(errorTags, item, explanations) {
  // モード2/3(数字入力)でも、解説は綴り(スペイン語表記)を示す方が学習に有用
  const correctText = spellingFor(item);
  const lines = [];
  for (const tag of errorTags) {
    const entry = explanations && explanations.numbers && explanations.numbers[tag];
    if (entry) {
      lines.push(entry.template.replace(/\{correct\}/g, correctText));
    } else {
      lines.push(`正解は ${correctText} です。`);
    }
  }
  return lines.join(" ");
}

/**
 * 数字入力モード(SPEC 8.3 モード2/3)用の4択ダミーを3つ生成する。
 * 近傍値・桁の入れ替え・末尾の入れ替えなど、聞き間違い/見間違いを想定した数値を生成する。
 * @param {number} value
 * @returns {string[]}
 */
function numericDistractorsFor(value) {
  const correct = String(value);
  const candidates = [];

  // 末尾の数字の入れ替え(聞き間違い: 例 777 -> 778)
  if (correct.length >= 1) {
    const last = Number(correct[correct.length - 1]);
    const swapped = (last + 1) % 10;
    candidates.push(correct.slice(0, -1) + swapped);
  }
  // 十の位の入れ替え(例 123 -> 113)
  if (correct.length >= 2) {
    const idx = correct.length - 2;
    const digit = Number(correct[idx]);
    const swapped = (digit + 1) % 10;
    candidates.push(correct.slice(0, idx) + swapped + correct.slice(idx + 1));
  }
  // ±10, ±100の近傍値
  for (const delta of [10, -10, 100, -100]) {
    const alt = value + delta;
    if (alt >= 0 && alt <= 1000000) candidates.push(String(alt));
  }
  // 桁の入れ替え(transposition): 例 123 -> 132
  if (correct.length >= 2) {
    const chars = correct.split("");
    const i = chars.length - 1;
    [chars[i], chars[i - 1]] = [chars[i - 1], chars[i]];
    const transposed = chars.join("").replace(/^0+(?=\d)/, "");
    candidates.push(transposed);
  }

  const result = [];
  const seen = new Set([correct]);
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    result.push(c);
    if (result.length === 3) break;
  }
  return result;
}

/**
 * 4択ダミーを3つ生成する(SPEC 8.2 数字)。
 * ①y の位置誤り ②cien/ciento取り違え ③不規則百位の規則化 ④アクセント除去
 * @param {object} item
 * @param {{text: string}} answer
 * @returns {string[]}
 */
export function distractorsFor(item, answer) {
  const { value, mode } = item.payload;
  const correct = answer.text;
  const candidates = [];

  if (mode === "to_number" || mode === "listen") {
    return numericDistractorsFor(value);
  }

  // ① y の位置誤り
  if (/ y /.test(correct)) {
    candidates.push(correct.replace(" y ", " "));
  } else if (value >= 16 && value <= 29) {
    // 一語を分かち書き化(fusion_split方向のダミー)
    const tens = TWENTIES.length ? null : null;
    if (value <= 19) {
      candidates.push(`diez y ${UNITS_0_15[value - 10]}`);
    } else {
      candidates.push(`veinte y ${value === 20 ? "" : UNITS_0_15[value - 20]}`.trim());
    }
  }

  // ② cien/ciento の取り違え
  if (value === 100) {
    candidates.push(correct.replace(/^cien$/, "ciento"));
  } else if (value >= 101 && value <= 199) {
    candidates.push(correct.replace(/^ciento\b/, "cien"));
  } else if (value === 100000) {
    candidates.push(correct.replace(/^cien\b/, "ciento"));
  }

  // ③ 不規則百位の規則化
  const hundredsDigit = Math.floor((value % 1000) / 100);
  if ([5, 7, 9].includes(hundredsDigit)) {
    const irregular = HUNDREDS_IRREGULAR[hundredsDigit];
    const regularized = UNITS_0_15[hundredsDigit] + "cientos";
    if (correct.includes(irregular)) {
      candidates.push(correct.replace(irregular, regularized));
    }
  }

  // ④ アクセント除去
  const noAccent = stripAccents(correct);
  if (noAccent !== correct) candidates.push(noAccent);

  // 重複・正解と同一なものを排除し、3つに絞る
  const result = [];
  const seen = new Set([correct]);
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    result.push(c);
    if (result.length === 3) break;
  }
  // 不足分は簡易な数値ズラし(±1)で補完
  let offset = 1;
  while (result.length < 3) {
    const altValue = value + offset;
    if (altValue >= 0 && altValue <= 1000000) {
      const alt = numToWords(altValue);
      if (!seen.has(alt)) {
        seen.add(alt);
        result.push(alt);
      }
    }
    offset = offset > 0 ? -offset : -offset + 1;
    if (offset > 5 || offset < -5) break;
  }
  return result;
}

export const id = MODULE_ID;

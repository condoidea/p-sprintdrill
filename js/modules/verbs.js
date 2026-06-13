// 動詞モジュール: 規則活用エンジン + features上書き + ドリル用 ModuleInterface 実装
// データファイルは fetch せず init(data) で注入を受ける(Node/ブラウザ両対応)

let DATA = null;
let VERB_MAP = null;

/**
 * verbs.json を注入する。
 * @param {object} data - data/verbs.json の内容
 */
export function init(data) {
  DATA = data;
  VERB_MAP = new Map(data.verbs.map((v) => [v.inf, v]));
}

const MODULE_ID = "verbs";

// 人称キーの正規化(検証データの表記ゆらぎに対応)
const PERSON_ALIASES = {
  yo: "yo",
  tu: "tu", "tú": "tu",
  el: "el", "él": "el", ella: "el", usted: "el", "3sg": "el",
  nosotros: "nosotros",
  vosotros: "vosotros",
  ellos: "ellos", ellas: "ellos", ustedes: "ellos", "3pl": "ellos",
  "-": "-",
};
const PERSONS = ["yo", "tu", "el", "nosotros", "vosotros", "ellos"];

function normPerson(p) {
  const norm = PERSON_ALIASES[p];
  if (!norm) throw new Error(`unknown person: ${p}`);
  return norm;
}

// 再帰代名詞(pronominal動詞用)
const REFLEXIVE_PRONOUNS = { yo: "me", tu: "te", el: "se", nosotros: "nos", vosotros: "os", ellos: "se" };

// --- 規則活用の語尾テーブル ----------------------------------------------

const PRES_ENDINGS = {
  ar: ["o", "as", "a", "amos", "áis", "an"],
  er: ["o", "es", "e", "emos", "éis", "en"],
  ir: ["o", "es", "e", "imos", "ís", "en"],
};
const PRET_ENDINGS = {
  ar: ["é", "aste", "ó", "amos", "asteis", "aron"],
  er: ["í", "iste", "ió", "imos", "isteis", "ieron"],
  ir: ["í", "iste", "ió", "imos", "isteis", "ieron"],
};
const IMPERF_ENDINGS = {
  ar: ["aba", "abas", "aba", "ábamos", "abais", "aban"],
  er: ["ía", "ías", "ía", "íamos", "íais", "ían"],
  ir: ["ía", "ías", "ía", "íamos", "íais", "ían"],
};
const FUT_ENDINGS = ["é", "ás", "á", "emos", "éis", "án"];
const COND_ENDINGS = ["ía", "ías", "ía", "íamos", "íais", "ían"];
// 接続法現在: -ar動詞は er/ir型語尾(e系)、-er/-ir動詞は ar型語尾(a系) = 「反対語尾」
const SUBJ_ENDINGS = {
  ar: ["e", "es", "e", "emos", "éis", "en"],
  er: ["a", "as", "a", "amos", "áis", "an"],
  ir: ["a", "as", "a", "amos", "áis", "an"],
};
// 強変化点過去の無アクセント語尾
const PRET_STRONG_ENDINGS = ["e", "iste", "o", "imos", "isteis", "ieron"];
const PRET_STRONG_ENDINGS_J = ["e", "iste", "o", "imos", "isteis", "eron"]; // j終わり語幹は3plが-eron

// --- full_override 動詞 ---------------------------------------------------
// 全活用表を直書き。"-" キーは人称なし(participio/ger)。

const FULL_OVERRIDE = {
  ser: {
    pres: ["soy", "eres", "es", "somos", "sois", "son"],
    pret: ["fui", "fuiste", "fue", "fuimos", "fuisteis", "fueron"],
    imperf: ["era", "eras", "era", "éramos", "erais", "eran"],
    fut: ["seré", "serás", "será", "seremos", "seréis", "serán"],
    cond: ["sería", "serías", "sería", "seríamos", "seríais", "serían"],
    subj: ["sea", "seas", "sea", "seamos", "seáis", "sean"],
    imp_af: { tu: "sé", el: "sea" },
    imp_neg: { tu: "no seas", el: "no sea" },
    participio: "sido",
    ger: "siendo",
  },
  ir: {
    pres: ["voy", "vas", "va", "vamos", "vais", "van"],
    pret: ["fui", "fuiste", "fue", "fuimos", "fuisteis", "fueron"],
    imperf: ["iba", "ibas", "iba", "íbamos", "ibais", "iban"],
    fut: ["iré", "irás", "irá", "iremos", "iréis", "irán"],
    cond: ["iría", "irías", "iría", "iríamos", "iríais", "irían"],
    subj: ["vaya", "vayas", "vaya", "vayamos", "vayáis", "vayan"],
    imp_af: { tu: "ve", el: "vaya" },
    imp_neg: { tu: "no vayas", el: "no vaya" },
    participio: "ido",
    ger: "yendo",
  },
  estar: {
    pres: ["estoy", "estás", "está", "estamos", "estáis", "están"],
    pret: ["estuve", "estuviste", "estuvo", "estuvimos", "estuvisteis", "estuvieron"],
    imperf: ["estaba", "estabas", "estaba", "estábamos", "estabais", "estaban"],
    fut: ["estaré", "estarás", "estará", "estaremos", "estaréis", "estarán"],
    cond: ["estaría", "estarías", "estaría", "estaríamos", "estaríais", "estarían"],
    subj: ["esté", "estés", "esté", "estemos", "estéis", "estén"],
    imp_af: { tu: "está", el: "esté" },
    imp_neg: { tu: "no estés", el: "no esté" },
    participio: "estado",
    ger: "estando",
  },
  haber: {
    pres: ["he", "has", "ha", "hemos", "habéis", "han"],
    pret: ["hube", "hubiste", "hubo", "hubimos", "hubisteis", "hubieron"],
    imperf: ["había", "habías", "había", "habíamos", "habíais", "habían"],
    fut: ["habré", "habrás", "habrá", "habremos", "habréis", "habrán"],
    cond: ["habría", "habrías", "habría", "habríamos", "habríais", "habrían"],
    subj: ["haya", "hayas", "haya", "hayamos", "hayáis", "hayan"],
    imp_af: { tu: "he", el: "haya" },
    imp_neg: { tu: "no hayas", el: "no haya" },
    participio: "habido",
    ger: "habiendo",
  },
  dar: {
    pres: ["doy", "das", "da", "damos", "dais", "dan"],
    pret: ["di", "diste", "dio", "dimos", "disteis", "dieron"],
    imperf: ["daba", "dabas", "daba", "dábamos", "dabais", "daban"],
    fut: ["daré", "darás", "dará", "daremos", "daréis", "darán"],
    cond: ["daría", "darías", "daría", "daríamos", "daríais", "darían"],
    subj: ["dé", "des", "dé", "demos", "deis", "den"],
    imp_af: { tu: "da", el: "dé" },
    imp_neg: { tu: "no des", el: "no dé" },
    participio: "dado",
    ger: "dando",
  },
  ver: {
    pres: ["veo", "ves", "ve", "vemos", "veis", "ven"],
    pret: ["vi", "viste", "vio", "vimos", "visteis", "vieron"],
    imperf: ["veía", "veías", "veía", "veíamos", "veíais", "veían"],
    fut: ["veré", "verás", "verá", "veremos", "veréis", "verán"],
    cond: ["vería", "verías", "vería", "veríamos", "veríais", "verían"],
    subj: ["vea", "veas", "vea", "veamos", "veáis", "vean"],
    imp_af: { tu: "ve", el: "vea" },
    imp_neg: { tu: "no veas", el: "no vea" },
    participio: "visto",
    ger: "viendo",
  },
  saber: {
    pres: ["sé", "sabes", "sabe", "sabemos", "sabéis", "saben"],
    pret: ["supe", "supiste", "supo", "supimos", "supisteis", "supieron"],
    imperf: ["sabía", "sabías", "sabía", "sabíamos", "sabíais", "sabían"],
    fut: ["sabré", "sabrás", "sabrá", "sabremos", "sabréis", "sabrán"],
    cond: ["sabría", "sabrías", "sabría", "sabríamos", "sabríais", "sabrían"],
    subj: ["sepa", "sepas", "sepa", "sepamos", "sepáis", "sepan"],
    imp_af: { tu: "sabe", el: "sepa" },
    imp_neg: { tu: "no sepas", el: "no sepa" },
    participio: "sabido",
    ger: "sabiendo",
  },
};

// --- 接続法現在の不規則6種 -------------------------------------------------
const SUBJ_IRREGULAR = {
  ser: ["sea", "seas", "sea", "seamos", "seáis", "sean"],
  ir: ["vaya", "vayas", "vaya", "vayamos", "vayáis", "vayan"],
  estar: ["esté", "estés", "esté", "estemos", "estéis", "estén"],
  dar: ["dé", "des", "dé", "demos", "deis", "den"],
  saber: ["sepa", "sepas", "sepa", "sepamos", "sepáis", "sepan"],
  haber: ["haya", "hayas", "haya", "hayamos", "hayáis", "hayan"],
};

// --- 正書法変化 ------------------------------------------------------------
// stem末尾の子音を、続く語尾の先頭母音に応じて調整する
function applySpelling(stem, spelling, nextVowel) {
  if (!spelling) return stem;
  const eLike = nextVowel === "e" || nextVowel === "i"; // 軟音化が必要な母音
  switch (spelling) {
    case "c>qu": // buscar -> busqué/busque (c+e/i は /s/ になるので qu に)
      if (eLike && stem.endsWith("c")) return stem.slice(0, -1) + "qu";
      return stem;
    case "g>gu": // llegar -> llegué/llegue (g+e/i は /x/ になるので gu に)
      if (eLike && stem.endsWith("g")) return stem.slice(0, -1) + "gu";
      return stem;
    case "z>c": // empezar -> empecé/empiece (z+e/i は避ける)
      if (eLike && stem.endsWith("z")) return stem.slice(0, -1) + "c";
      return stem;
    case "gu>g": // seguir -> sigo/siga (gu+a/o は g に。/g/音保持にuが不要)
      if (!eLike && stem.endsWith("gu")) return stem.slice(0, -1);
      return stem;
    case "g>j": // 一部動詞用(未使用だが拡張余地)
      if (!eLike && stem.endsWith("g")) return stem.slice(0, -1) + "j";
      return stem;
    default:
      return stem;
  }
}

// --- 語幹母音変化(ブーツ型) ------------------------------------------------
// stem_change: "e>ie" | "o>ue" | "e>i" | "u>ue"
// 最後の母音(連続するe/o/u)を変化させる
function applyStemChange(stem, change) {
  if (!change) return stem;
  const [from, to] = change.split(">");
  // 語幹の最後の母音(変化対象)を探す。連続するgu/quの後のuは対象外とする簡易ロジック
  for (let i = stem.length - 1; i >= 0; i--) {
    if (stem[i] === from) {
      return stem.slice(0, i) + to + stem.slice(i + 1);
    }
  }
  return stem;
}

// pret_3rd_change: "e>i" | "o>u" (-ir語幹変化動詞のみ)
function applyPret3rdChange(stem, change) {
  if (!change) return stem;
  const [from, to] = change.split(">");
  for (let i = stem.length - 1; i >= 0; i--) {
    if (stem[i] === from) {
      return stem.slice(0, i) + to + stem.slice(i + 1);
    }
  }
  return stem;
}

// --- アクセント語幹(enviar/continuar型) ------------------------------------
// accent_stem: "i>í" | "u>ú" — yo/tu/el/ellos(boot)で語幹末のi/uにアクセント
function applyAccentStem(stem, accentStem) {
  if (!accentStem) return stem;
  const [from, to] = accentStem.split(">");
  if (stem.endsWith(from)) return stem.slice(0, -1) + to;
  return stem;
}

// --- アクセント除去ユーティリティ -------------------------------------------
const ACCENT_MAP = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "ñ", ü: "u" };
function stripAccents(s) {
  return s
    .split("")
    .map((c) => ACCENT_MAP[c] ?? c)
    .join("");
}

// --- y挿入(leer/oír/construir型) -------------------------------------------
// 母音間の i が y になる。pret 3sg/3pl の ió/ieron -> yó/yeron、ger の iendo -> yendo
function applyYInsertEnding(ending) {
  if (ending.startsWith("ió")) return "y" + ending.slice(1);
  if (ending.startsWith("ie")) return "y" + ending.slice(1);
  if (ending.startsWith("i") && !ending.startsWith("ist")) return "y" + ending.slice(1);
  return ending;
}

// --- 動詞情報取得 -----------------------------------------------------------
function getVerbInfo(inf) {
  const v = VERB_MAP.get(inf);
  if (!v) throw new Error(`unknown verb: ${inf}`);
  return v;
}
function getStem(inf, conj) {
  // pronominal動詞(levantarse等)は語末の"se"を先に除去してから-ar/-er/-irを除去
  const base = inf.endsWith("se") ? inf.slice(0, -2) : inf;
  return base.slice(0, -2);
}

// =========================================================================
// 各時制ごとの活用生成
// =========================================================================

/** 直説法現在の全人称形を返す */
function conjugatePresent(verb) {
  const { inf, conj, features = {} } = verb;
  const stem = getStem(inf, conj);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const person = PERSONS[i];
    let s = stem;
    let ending = PRES_ENDINGS[conj][i];

    if (person === "yo" && features.yo_irreg) {
      out.push(features.yo_irreg);
      continue;
    }

    // oír の特殊形(y_insert内の例外)
    if (inf === "oír") {
      const oirForms = ["oigo", "oyes", "oye", "oímos", "oís", "oyen"];
      out.push(oirForms[i]);
      continue;
    }

    // ブーツ型語幹変化: yo/tu/el/ellos のみ
    if (features.stem_change && person !== "nosotros" && person !== "vosotros") {
      s = applyStemChange(s, features.stem_change);
    }
    // アクセント語幹: yo/tu/el/ellos のみ
    if (features.accent_stem && person !== "nosotros" && person !== "vosotros") {
      s = applyAccentStem(s, features.accent_stem);
    }
    // y挿入: -uir型は直説法現在にもy(母音+iendo/es/e/en パターン)
    if (features.y_insert && conj === "ir" && stem.endsWith("u")) {
      if (person !== "nosotros" && person !== "vosotros") {
        ending = applyYInsertConsonantEnding(ending);
      }
    }
    // 正書法変化(gu>g): seguir型は語尾がo/aで始まるとき発火(sigo, siga系は接続法側)
    if (features.spelling === "gu>g") {
      s = applySpelling(s, features.spelling, ending[0]);
    }
    out.push(s + ending);
  }
  return out;
}

// -uir型の直説法現在語尾にyを挿入(o->yo, es->yes, e->ye, en->yen)
function applyYInsertConsonantEnding(ending) {
  return "y" + ending;
}

/** 直説法点過去の全人称形を返す */
function conjugatePreterite(verb) {
  const { inf, conj, features = {} } = verb;
  const stem = getStem(inf, conj);
  const out = [];

  if (features.pret_strong) {
    const strongStem = features.pret_strong;
    const endings = strongStem.endsWith("j") ? PRET_STRONG_ENDINGS_J : PRET_STRONG_ENDINGS;
    for (let i = 0; i < 6; i++) {
      out.push(strongStem + endings[i]);
    }
    if (features.pret_3sg) out[2] = features.pret_3sg; // hacer: hizo
    return out;
  }

  for (let i = 0; i < 6; i++) {
    const person = PERSONS[i];
    let s = stem;
    let ending = PRET_ENDINGS[conj][i];

    // 正書法変化: yo (-é) で発火
    if (person === "yo" && features.spelling) {
      s = applySpelling(s, features.spelling, "e");
    }

    // y挿入: leer/creer/construir型。3sg/3plの-ió/-ieronがyo/yeronに
    if (features.y_insert && (person === "el" || person === "ellos")) {
      ending = applyYInsertEnding(ending);
    }

    // y挿入: 語幹が強母音(a/e/o)で終わる型(leer/creer/oír)はtú/nosotros/vosotrosの
    // 語尾先頭iにアクセント(leíste/leímos/leísteis)。construir(語幹がu終わり)は無アクセント。
    if (features.y_insert && /[aeo]$/.test(stem) && (person === "tu" || person === "nosotros" || person === "vosotros")) {
      ending = "í" + ending.slice(1);
    }

    // pret_3rd_change: -ir語幹変化動詞の3sg/3pl
    if (features.pret_3rd_change && (person === "el" || person === "ellos")) {
      s = applyPret3rdChange(s, features.pret_3rd_change);
    }

    out.push(s + ending);
  }
  if (features.pret_3sg) out[2] = features.pret_3sg;
  return out;
}

/** 直説法線過去の全人称形を返す(不規則は full_override で対応済み) */
function conjugateImperfect(verb) {
  const { inf, conj } = verb;
  const stem = getStem(inf, conj);
  return IMPERF_ENDINGS[conj].map((e) => stem + e);
}

/** 未来・過去未来の規則語幹を返す(不定詞からアクセントを除去して作る: oír -> oir) */
function futureStem(verb) {
  const { inf, features = {} } = verb;
  if (features.fut_stem) return features.fut_stem;
  const base = inf.endsWith("se") ? inf.slice(0, -2) : inf;
  return stripAccents(base);
}

/** 直説法未来の全人称形を返す */
function conjugateFuture(verb) {
  const stem = futureStem(verb);
  return FUT_ENDINGS.map((e) => stem + e);
}

/** 直説法過去未来(条件法)の全人称形を返す */
function conjugateConditional(verb) {
  const stem = futureStem(verb);
  return COND_ENDINGS.map((e) => stem + e);
}

/**
 * 接続法現在の全人称形を返す。
 * 「直説法yo形の語幹 + 反対語尾」が基本。nosotros/vosotrosは以下の優先順位で語幹を決定する:
 *   1. yo_irreg がある場合: その子音を保持(tengamos, digamos, conozcamos, oigamos等)
 *   2. -ir語幹変化動詞(pret_3rd_change)の場合: その母音(durmamos, sintamos, pidamos)
 *   3. -uir型(y_insert かつ語幹がuで終わる)の場合: y を保持(construyamos)
 *   4. それ以外(ブーツ型stem_change・accent_stem等): 原形語幹に戻す(pensemos, podamos, enviemos)
 * spelling変化は全人称で適用する。
 */
function conjugateSubjunctive(verb) {
  const { inf, conj, features = {} } = verb;

  if (SUBJ_IRREGULAR[inf]) return SUBJ_IRREGULAR[inf];

  const baseStem = getStem(inf, conj);
  const presYo = conjugatePresent(verb)[0]; // 直説法yo形
  // yo形からendingの"o"(または不規則語尾)を除去して語幹を得る
  let yoStem;
  if (presYo.endsWith("o")) {
    yoStem = presYo.slice(0, -1);
  } else {
    yoStem = presYo; // sé, voy等は通常full_override/SUBJ_IRREGULARで処理済み
  }

  // nosotros/vosotros用の語幹(上記の優先順位)
  let nosVosStem;
  if (features.yo_irreg) {
    // yo_irreg(tengo, digo, conozco, oigo等)の子音を保持(末尾の"o"を除去)
    nosVosStem = features.yo_irreg.endsWith("o") ? features.yo_irreg.slice(0, -1) : features.yo_irreg;
  } else if (features.pret_3rd_change) {
    nosVosStem = applyPret3rdChange(baseStem, features.pret_3rd_change);
  } else if (features.y_insert && conj === "ir" && baseStem.endsWith("u")) {
    nosVosStem = baseStem + "y";
  } else {
    nosVosStem = baseStem;
  }

  const endings = SUBJ_ENDINGS[conj];
  const out = [];
  for (let i = 0; i < 6; i++) {
    const person = PERSONS[i];
    let s;
    if (person === "nosotros" || person === "vosotros") {
      s = nosVosStem;
    } else {
      // yo/tu/el/ellos: 直説法yo形語幹(ブーツ型変化込み)を使用
      s = yoStem;
    }
    let ending = endings[i];
    // 正書法変化: 接続法現在は全人称で発火(busque, llegue, empiece, juegue, siga)
    if (features.spelling) {
      const nextVowel = ending[0];
      s = applySpelling(s, features.spelling, nextVowel);
    }
    out.push(s + ending);
  }
  return out;
}

/** 命令法肯定(tú, usted)を返す */
function imperativeAffirmative(verb, subjForms, presForms) {
  const { inf, conj, features = {} } = verb;
  if (FULL_OVERRIDE[inf]) {
    return { tu: FULL_OVERRIDE[inf].imp_af.tu, el: FULL_OVERRIDE[inf].imp_af.el };
  }
  // tú: 不規則(imp_tu)優先、なければ直説法現在3sg(él)形
  const tu = features.imp_tu || presForms[2];
  // usted: 接続法現在3sg(él)形
  const el = subjForms[2];
  return { tu, el };
}

/** 命令法否定(tú, usted) = no + 接続法現在 */
function imperativeNegative(subjForms) {
  return { tu: "no " + subjForms[1], el: "no " + subjForms[2] };
}

/** 過去分詞を返す */
function conjugateParticiple(verb) {
  const { inf, conj, features = {} } = verb;
  if (FULL_OVERRIDE[inf]) return FULL_OVERRIDE[inf].participio;
  if (features.participle) return features.participle;
  const stem = getStem(inf, conj);
  return conj === "ar" ? stem + "ado" : stem + "ido";
}

/** 現在分詞(gerundio)を返す */
function conjugateGerundio(verb) {
  const { inf, conj, features = {} } = verb;
  if (FULL_OVERRIDE[inf]) return FULL_OVERRIDE[inf].ger;
  const stem = getStem(inf, conj);
  if (conj === "ar") return stem + "ando";

  // -ir語幹変化動詞: pret_3rd_changeの母音(durmiendo, pidiendo)
  let s = stem;
  if (features.pret_3rd_change) {
    s = applyPret3rdChange(s, features.pret_3rd_change);
  }
  // y挿入: 母音語幹+iendo -> yendo (leyendo, construyendo)
  if (s.match(/[aeiou]$/)) {
    return s + "yendo";
  }
  return s + "iendo";
}

/** 現在完了 = haber現在 + 過去分詞 */
function conjugatePerfecto(verb) {
  const haberPres = FULL_OVERRIDE.haber.pres;
  const participio = conjugateParticiple(verb);
  return haberPres.map((h) => `${h} ${participio}`);
}

// --- 動詞全体の活用表を構築 -------------------------------------------------

/**
 * 指定動詞の全活用表を生成する。
 * @param {string} inf - 不定詞
 * @returns {object} 時制キー -> (人称配列 or 文字列 or オブジェクト)
 */
function conjugateAll(inf) {
  const verb = getVerbInfo(inf);

  if (FULL_OVERRIDE[inf]) {
    const fo = FULL_OVERRIDE[inf];
    const subj = fo.subj;
    return {
      pres: fo.pres,
      pret: fo.pret,
      imperf: fo.imperf,
      fut: fo.fut,
      cond: fo.cond,
      subj,
      imp_af: fo.imp_af,
      imp_neg: fo.imp_neg,
      participio: fo.participio,
      perfecto: conjugatePerfecto(verb),
      ger: fo.ger,
    };
  }

  const pres = conjugatePresent(verb);
  const pret = conjugatePreterite(verb);
  const imperf = conjugateImperfect(verb);
  const fut = conjugateFuture(verb);
  const cond = conjugateConditional(verb);
  const subj = conjugateSubjunctive(verb);
  const participio = conjugateParticiple(verb);
  const ger = conjugateGerundio(verb);
  const perfecto = conjugatePerfecto(verb);
  const imp_af = imperativeAffirmative(verb, subj, pres);
  const imp_neg = imperativeNegative(subj);

  return { pres, pret, imperf, fut, cond, subj, imp_af, imp_neg, participio, perfecto, ger };
}

/**
 * 指定時制・人称の活用形を取得する(再帰代名詞は付与しない素の形)。
 * @param {string} inf
 * @param {string} tense - pres|pret|imperf|fut|cond|subj|imp_af|imp_neg|participio|perfecto|ger
 * @param {string} person - yo|tu|el|nosotros|vosotros|ellos|"-"
 * @returns {string}
 */
function rawForm(inf, tense, person) {
  const table = conjugateAll(inf);
  const p = normPerson(person);

  if (tense === "participio" || tense === "ger") {
    return table[tense];
  }
  if (tense === "imp_af" || tense === "imp_neg") {
    if (p !== "tu" && p !== "el") throw new Error(`imperative requires tu/el person, got ${person}`);
    return table[tense][p];
  }
  const idx = PERSONS.indexOf(p);
  if (idx === -1) throw new Error(`invalid person for tense ${tense}: ${person}`);
  return table[tense][idx];
}

/**
 * 再帰代名詞を付与した形を返す(pronominal動詞用)。
 * 直説法/接続法/完了形: 代名詞は動詞の前
 * 命令肯定: 代名詞は動詞の後に結合(アクセント位置調整は簡易対応)
 * 命令否定: 代名詞は no と動詞の間
 * 現在分詞: 代名詞は動詞の後に結合
 * @returns {string}
 */
function withReflexive(inf, tense, person, form) {
  return withReflexiveDetail(inf, tense, person, form).text;
}

/**
 * withReflexiveの詳細版。segments構築用に代名詞の位置情報を返す。
 * @returns {{text: string, pronoun: string|null, pos: "prefix"|"suffix"|"none"}}
 */
function withReflexiveDetail(inf, tense, person, form) {
  const verb = getVerbInfo(inf);
  if (!(verb.features && verb.features.pronominal)) return { text: form, pronoun: null, pos: "none" };
  const p = normPerson(person);

  if (tense === "participio") return { text: form, pronoun: null, pos: "none" }; // 分詞単体には付与しない

  if (tense === "imp_af") {
    const pron = p === "tu" ? "te" : "se";
    return { text: attachEnclitic(form, pron), pronoun: pron, pos: "suffix" };
  }
  if (tense === "imp_neg") {
    const pron = p === "tu" ? "te" : "se";
    // "no <verb>" -> "no te <verb>"
    return { text: form.replace(/^no /, `no ${pron} `), pronoun: pron, pos: "prefix" };
  }
  if (tense === "ger") {
    // 代名詞は人称依存だが、ger単体出題はデフォルト3人称(se)とする
    return { text: attachEnclitic(form, "se"), pronoun: "se", pos: "suffix" };
  }
  const pron = REFLEXIVE_PRONOUNS[p];
  return { text: `${pron} ${form}`, pronoun: pron, pos: "prefix" };
}

// 動詞末尾に代名詞を結合し、必要ならアクセント記号を補う(簡易: 最後の音節にアクセント)
function attachEnclitic(verbForm, pron) {
  // すでにアクセント記号がある場合はそのまま結合(levántate等は事前に決定が必要なため、
  // 2音節以上で語末にアクセントが無い場合のみ簡易付与)
  const hasAccent = /[áéíóúÁÉÍÓÚ]/.test(verbForm);
  const combined = verbForm + pron;
  if (hasAccent) return combined;
  // 動詞部分が2音節以上ならアクセント付与(levanta+te -> levántate)
  if (verbForm.length >= 3) {
    return addAccentToPenultimate(verbForm) + pron;
  }
  return combined;
}

// 語末から2文字目の母音にアクセントを付与する(簡易実装)
function addAccentToPenultimate(word) {
  const vowels = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
  const chars = word.split("");
  // 語末から2番目の母音を探す(末尾文字を除いた範囲)
  for (let i = chars.length - 2; i >= 0; i--) {
    if (vowels[chars[i]]) {
      chars[i] = vowels[chars[i]];
      return chars.join("");
    }
  }
  return word;
}

// =========================================================================
// 知識マップ用: 動詞タイプ分類(SPEC 11.4)
// =========================================================================

// 知識マップの列定義(優先度順: 上から判定して最初に当たったタイプを採用)。
// tier3規則動詞は "regular" に集約される。
export const VERB_TYPES = [
  { key: "full_override", label: "完全不規則" },
  { key: "pret_strong", label: "強変化点過去" },
  { key: "stem_e_ie", label: "語幹変化 e>ie" },
  { key: "stem_o_ue", label: "語幹変化 o>ue" },
  { key: "stem_e_i", label: "語幹変化 e>i" },
  { key: "yo_irreg", label: "yo不規則" },
  { key: "spelling", label: "正書法変化" },
  { key: "regular", label: "規則(ar/er/ir)" },
];

/**
 * 動詞を知識マップの列(動詞タイプ)に分類する(SPEC 11.4)。
 * 優先度: 完全不規則 > 強変化点過去 > 語幹変化(e>ie/o>ue/e>i, u>ueはo>ueに含める)
 *        > yo不規則 > 正書法変化(spelling/y_insert/accent_stem) > 規則
 * @param {object} verb - data/verbs.json の verbs[] 要素
 * @returns {string} VERB_TYPES の key
 */
export function verbTypeFor(verb) {
  const features = verb.features || {};
  if (features.full_override) return "full_override";
  if (features.pret_strong) return "pret_strong";
  if (features.stem_change) {
    const [from, to] = features.stem_change.split(">");
    if (to === "ie") return "stem_e_ie";
    if (to === "ue") return "stem_o_ue"; // o>ue, u>ue
    if (to === "i") return "stem_e_i";
  }
  if (features.yo_irreg) return "yo_irreg";
  if (features.spelling || features.y_insert || features.accent_stem) return "spelling";
  return "regular";
}

// =========================================================================
// gustar型(SPEC 11.3)
// =========================================================================

// 間接目的語代名詞(人称ごと)
const IO_PRONOUNS = { yo: "me", tu: "te", el: "le", nosotros: "nos", vosotros: "os", ellos: "les" };
// 「(A 〜)」の前置詞句(問題文表示用)
export const A_PHRASES = {
  yo: "A mí", tu: "A ti", el: "A él/ella/usted",
  nosotros: "A nosotros", vosotros: "A vosotros", ellos: "A ellos/ellas/ustedes",
};

// gustar/encantar型(任意の名詞)の主語サンプル。doler型(身体の痛み)は別途用意。
const GUSTAR_SUBJECTS = [
  { es: "el libro", ja: "本", plural: false },
  { es: "los libros", ja: "本", plural: true },
  { es: "la música", ja: "音楽", plural: false },
  { es: "las películas", ja: "映画", plural: true },
];
// doler型の主語サンプル(身体の部位)
const DOLER_SUBJECTS = [
  { es: "la cabeza", ja: "頭", plural: false },
  { es: "los pies", ja: "足", plural: true },
];

/**
 * gustar型動詞の主語サンプルを返す(doler型は身体の部位、それ以外は一般名詞)。
 * @param {object} features
 * @returns {Array}
 */
function gustarSubjectsFor(features) {
  return features.stem_change ? DOLER_SUBJECTS : GUSTAR_SUBJECTS;
}

// =========================================================================
// ModuleInterface 実装
// =========================================================================

// ドリル出題対象の時制一覧(現在完了・gerundioは設定でON)
const PERSONAL_TENSES = ["pres", "pret", "imperf", "fut", "cond", "subj"];

/**
 * 学習項目を全列挙する。
 * gustar_type / third_person_only の動詞は通常の人称活用ドリルから除外。
 * @returns {Array}
 */
export function generateItems() {
  const items = [];
  for (const verb of DATA.verbs) {
    const features = verb.features || {};
    const verbType = verbTypeFor(verb);

    if (features.gustar_type) {
      // gustar型: 「(A 〜) 代名詞 + gusta(n)/encanta(n)/duele(n) + 主語」の専用問題(SPEC 11.3)。
      // 主語の単複 × 人称(間接目的語代名詞)の組み合わせで出題する。時制は現在のみ。
      const subjects = gustarSubjectsFor(features);
      for (const person of PERSONS) {
        for (const subject of subjects) {
          items.push({
            id: `verbs:${verb.inf}:gustar:${person}:${subject.es.replace(/\s+/g, "_")}`,
            moduleId: MODULE_ID,
            payload: { inf: verb.inf, ja: verb.ja, type: "gustar", person, subject, verbType },
            tier: verb.tier,
          });
        }
      }
      continue;
    }

    // 3人称のみで使う動詞(costar等)は、人称を伴う全ての形(接続法・完了形含む)で
    // 3人称(el/ellos)のみを出題対象とする。人称なし形(participio/ger)は常に許容。
    const personsForVerb = features.third_person_only ? ["el", "ellos"] : PERSONS;

    for (const tense of PERSONAL_TENSES) {
      for (const person of personsForVerb) {
        items.push({
          id: `verbs:${verb.inf}:${tense}:${person}`,
          moduleId: MODULE_ID,
          payload: { inf: verb.inf, tense, person, ja: verb.ja, verbType },
          tier: verb.tier,
        });
      }
    }

    // 命令法(肯定/否定 tú・usted)。3人称のみで使う動詞はusted(el)のみ。
    const imperativePersons = features.third_person_only ? ["el"] : ["tu", "el"];
    for (const tense of ["imp_af", "imp_neg"]) {
      for (const person of imperativePersons) {
        items.push({
          id: `verbs:${verb.inf}:${tense}:${person}`,
          moduleId: MODULE_ID,
          payload: { inf: verb.inf, tense, person, ja: verb.ja, verbType },
          tier: verb.tier,
        });
      }
    }

    // 過去分詞・現在完了・現在分詞
    items.push({
      id: `verbs:${verb.inf}:participio:-`,
      moduleId: MODULE_ID,
      payload: { inf: verb.inf, tense: "participio", person: "-", ja: verb.ja, verbType },
      tier: verb.tier,
    });
    for (const person of personsForVerb) {
      items.push({
        id: `verbs:${verb.inf}:perfecto:${person}`,
        moduleId: MODULE_ID,
        payload: { inf: verb.inf, tense: "perfecto", person, ja: verb.ja, verbType },
        tier: verb.tier,
      });
    }
    items.push({
      id: `verbs:${verb.inf}:ger:-`,
      moduleId: MODULE_ID,
      payload: { inf: verb.inf, tense: "ger", person: "-", ja: verb.ja, verbType },
      tier: verb.tier,
    });
  }
  return items;
}

/**
 * gustar型の動詞形(現在3sg/3pl)を主語の単複に応じて返す(gusta/gustan等)。
 * @param {string} inf
 * @param {boolean} plural - 主語が複数かどうか
 * @returns {string}
 */
function gustarVerbForm(inf, plural) {
  return rawForm(inf, "pres", plural ? "ellos" : "el");
}

/**
 * 正解(構造情報付き)を生成する。
 * 語幹部分(stem)をcriticalとしてsegmentsを構築する。
 * @param {object} item
 * @returns {{text: string, segments: Array}}
 */
export function answerFor(item) {
  const { inf, tense, person, type, subject } = item.payload;
  if (type === "gustar") {
    // gustar型(SPEC 11.3): 「(A 〜) 代名詞 + gusta(n)/encanta(n)/duele(n)」。
    // 代名詞は非critical、動詞形(単複・語幹変化を含む)がcritical。
    const pronoun = IO_PRONOUNS[normPerson(person)];
    const verbForm = gustarVerbForm(inf, subject.plural);
    const text = `${pronoun} ${verbForm}`;
    return {
      text,
      segments: [
        { text: `${pronoun} `, role: "pronoun", critical: false },
        { text: verbForm, role: "verb", critical: true },
      ],
    };
  }
  const verb = getVerbInfo(inf);
  const raw = rawForm(inf, tense, person);
  const detail = withReflexiveDetail(inf, tense, person, raw);
  const segments = buildSegments(verb, tense, person, raw, detail);
  return { text: detail.text, segments };
}

/**
 * 正解形を語幹(critical)と語尾に分割してsegmentsを構築する。
 * 命令否定("no ...")・現在完了("he hecho"等)・再帰代名詞付きは
 * 先頭/末尾の付加語(no/haber形/代名詞)を非criticalな別segmentとして分離する。
 */
function buildSegments(verb, tense, person, raw, detail) {
  const segments = [];
  let core = raw;

  // 否定命令: 「no + 接続法」-> noは非critical(代名詞付与前のrawを基準に分離)
  if (tense === "imp_neg") {
    core = raw.slice(3); // "no "
  }

  // 完了形: 「haber形 + 分詞」-> haber形は非critical
  let auxPart = null;
  if (tense === "perfecto") {
    const sp = core.indexOf(" ");
    auxPart = core.slice(0, sp);
    core = core.slice(sp + 1);
  }

  // 末尾に代名詞が結合する形(levántate等)は、アクセント変化後のcoreを使う
  if (detail.pos === "suffix") {
    core = detail.text.slice(0, detail.text.length - detail.pronoun.length);
  }

  // core を 語幹(stem) / 語尾(ending) に分割
  const { stem, ending } = splitStemEnding(verb, tense, person, core);

  // 代名詞のprefix(no te / me 等)を先頭segmentとして付与(語境界に半角スペースを含める)
  if (detail.pos === "prefix") {
    if (tense === "imp_neg") {
      segments.push({ text: `no ${detail.pronoun} `, role: "particle", critical: false });
    } else {
      segments.push({ text: `${detail.pronoun} `, role: "pronoun", critical: false });
    }
  } else if (tense === "imp_neg") {
    segments.push({ text: "no ", role: "particle", critical: false });
  }

  if (auxPart) segments.push({ text: `${auxPart} `, role: "aux", critical: false });

  if (stem) segments.push({ text: stem, role: "stem", critical: true });
  if (ending) segments.push({ text: ending, role: "ending", critical: false });

  // 代名詞のsuffix(levántate の te 等)を末尾segmentとして付与
  if (detail.pos === "suffix") {
    segments.push({ text: detail.pronoun, role: "pronoun", critical: false });
  }

  return segments;
}

/**
 * coreを語幹・語尾に分割する。不定詞語幹(getStem)を基準に、
 * その長さまでをstem、残りをendingとする簡易ロジック。
 * 不定詞語幹がcoreに含まれない場合(完全不規則)は全体をstemとする。
 */
function splitStemEnding(verb, tense, person, core) {
  if (tense === "participio" || tense === "ger") {
    // 分詞・現在分詞: 不規則形は全体をstem、規則形は -ado/-ido/-ando/-iendo/-yendo を分離
    const irregularSet = new Set(["hecho", "dicho", "visto", "escrito", "abierto", "puesto", "vuelto", "muerto", "sido", "ido", "yendo"]);
    if (irregularSet.has(core)) return { stem: core, ending: "" };
    for (const suf of ["ando", "iendo", "yendo", "ado", "ido"]) {
      if (core.endsWith(suf)) return { stem: core.slice(0, -suf.length), ending: suf };
    }
    return { stem: core, ending: "" };
  }

  const baseStem = getStem(verb.inf, verb.conj);
  // 規則的に語幹が前方一致する場合
  if (core.startsWith(baseStem)) {
    return { stem: baseStem, ending: core.slice(baseStem.length) };
  }
  // 語幹母音変化等で先頭が異なる場合: 同じ長さで切る
  if (core.length > baseStem.length) {
    return { stem: core.slice(0, baseStem.length), ending: core.slice(baseStem.length) };
  }
  // 完全不規則(full_override等): 全体をstemとする
  return { stem: core, ending: "" };
}

/**
 * ヒント段階制御用の急所定義。語幹(critical=true)のsegment indexを返す。
 */
export function criticalZone(item, answer) {
  const criticalIndexes = [];
  answer.segments.forEach((seg, i) => {
    if (seg.critical) criticalIndexes.push(i);
  });
  return { criticalIndexes, segments: answer.segments };
}

/**
 * 誤答を分類する(SPEC 7.2 ErrorTag)。
 * @param {object} item
 * @param {string} input
 * @param {{text: string}} answer
 * @returns {string[]}
 */
export function classifyError(item, input, answer) {
  const { inf, tense, person, type, subject } = item.payload;
  const norm = (s) => s.trim().toLowerCase();
  const a = norm(answer.text);
  const u = norm(input);
  const tags = [];

  if (type === "gustar") {
    // gustar型(SPEC 11.3): 単複ミス(gusta<->gustan)・代名詞ミス(me<->te等)を分類する。
    if (a === u) return tags;
    if (stripAccents(a) === stripAccents(u)) return ["accent_missing"];

    const pronoun = IO_PRONOUNS[normPerson(person)];
    const correctVerbForm = gustarVerbForm(inf, subject.plural);
    const oppositeVerbForm = gustarVerbForm(inf, !subject.plural);

    const gtags = [];
    // 代名詞ミス: 別の人称の代名詞 + 正しい動詞形(単複)と一致
    for (const p of PERSONS) {
      if (p === normPerson(person)) continue;
      const otherPronoun = IO_PRONOUNS[p];
      if (norm(`${otherPronoun} ${correctVerbForm}`) === u) {
        gtags.push("gustar_pronoun_wrong");
        break;
      }
    }
    // 単複ミス: 正しい代名詞 + 反対の単複の動詞形と一致
    if (norm(`${pronoun} ${oppositeVerbForm}`) === u) {
      gtags.push("gustar_number_wrong");
    }
    if (gtags.length === 0) gtags.push("other");
    return gtags;
  }

  const verb = getVerbInfo(inf);
  const features = verb.features || {};

  if (a === u) return tags; // 一致(正解)

  // accent_missing: アクセント除去後に一致
  if (stripAccents(a) === stripAccents(u)) {
    tags.push("accent_missing");
    return tags;
  }

  // imperative_polarity: 否定命令を肯定形(または直説法)で入力
  if (tense === "imp_neg") {
    const affForm = rawForm(inf, "imp_af", person);
    const subjForm = rawForm(inf, "subj", person);
    if (norm(affForm) === u || norm(subjForm) === u || !u.startsWith("no ")) {
      tags.push("imperative_polarity");
    }
  }

  // wrong_person: 同時制の別人称形と一致
  if ((tense === "pres" || tense === "pret" || tense === "imperf" || tense === "fut" || tense === "cond" || tense === "subj" || tense === "perfecto")) {
    for (const p of PERSONS) {
      if (p === normPerson(person)) continue;
      try {
        const otherRaw = rawForm(inf, tense, p);
        const other = withReflexive(inf, tense, p, otherRaw);
        if (norm(other) === u) {
          tags.push("wrong_person");
          break;
        }
      } catch (e) {
        // skip
      }
    }
  }

  // wrong_tense: 別時制の同人称形と一致
  if (tags.length === 0 && person !== "-") {
    for (const t of [...PERSONAL_TENSES, "imp_af", "imp_neg"]) {
      if (t === tense) continue;
      try {
        const pp = (t === "imp_af" || t === "imp_neg") ? (normPerson(person) === "tu" ? "tu" : "el") : person;
        const otherRaw = rawForm(inf, t, pp);
        const other = withReflexive(inf, t, pp, otherRaw);
        if (norm(other) === u) {
          tags.push("wrong_tense");
          break;
        }
      } catch (e) {
        // skip
      }
    }
  }

  // stem_change_missed: 規則活用形(語幹変化なし)を入力(ブーツ型該当人称)
  if (features.stem_change && (tense === "pres" || tense === "subj" || tense === "imp_af") && person !== "nosotros" && person !== "vosotros") {
    const regularStem = getStem(inf, verb.conj);
    const regularForm = buildRegularComparable(verb, tense, person, regularStem);
    if (regularForm && norm(regularForm) === u) {
      tags.push("stem_change_missed");
    }
  }

  // stem_change_overapplied: nosotros/vosotrosで語幹変化を適用した形
  if (features.stem_change && (person === "nosotros" || person === "vosotros") && (tense === "pres" || tense === "subj")) {
    const changedStem = applyStemChange(getStem(inf, verb.conj), features.stem_change);
    const overForm = buildRegularComparable(verb, tense, person, changedStem);
    if (overForm && norm(overForm) === u) {
      tags.push("stem_change_overapplied");
    }
  }

  // pret_3rd_change_missed: -ir語幹変化動詞の点過去3人称でe>i/o>u漏れ
  if (features.pret_3rd_change && tense === "pret" && (person === "el" || person === "ellos")) {
    const regularStem = getStem(inf, verb.conj);
    const ending = PRET_ENDINGS[verb.conj][PERSONS.indexOf(normPerson(person))];
    const missed = regularStem + ending;
    if (norm(missed) === u || stripAccents(norm(missed)) === stripAccents(u)) tags.push("pret_3rd_change_missed");
  }

  // strong_pret_missed: 強変化点過去を規則形で活用
  if (features.pret_strong && tense === "pret") {
    const regularStem = getStem(inf, verb.conj);
    const ending = PRET_ENDINGS[verb.conj][PERSONS.indexOf(normPerson(person))];
    const regularForm = regularStem + ending;
    if (norm(regularForm) === u) tags.push("strong_pret_missed");
  }

  // spelling_change_missed: busqué -> busqué抜きのbusqué(c)等
  if (features.spelling && ((tense === "pret" && person === "yo") || tense === "subj")) {
    const verbCopy = { ...verb, features: { ...features, spelling: undefined } };
    let withoutSpelling;
    if (tense === "pret") {
      withoutSpelling = conjugatePreterite(verbCopy)[0];
    } else {
      withoutSpelling = conjugateSubjunctive(verbCopy)[PERSONS.indexOf(normPerson(person))];
    }
    if (norm(withoutSpelling) === u || stripAccents(norm(withoutSpelling)) === stripAccents(u)) tags.push("spelling_change_missed");
  }

  // subj_stem_wrong: 接続法を不定詞語幹から作った
  if (tense === "subj" || tense === "imp_neg" || (tense === "imp_af" && person === "el")) {
    const infStem = getStem(inf, verb.conj);
    const subjEndings = SUBJ_ENDINGS[verb.conj];
    const idx = (tense === "subj") ? PERSONS.indexOf(normPerson(person)) : (normPerson(person) === "tu" ? 1 : 2);
    const wrongForm = infStem + subjEndings[idx];
    const compareTarget = tense === "imp_neg" ? `no ${wrongForm}` : wrongForm;
    if (norm(compareTarget) === u) tags.push("subj_stem_wrong");
  }

  // participle_irregular_missed: hacido等
  if ((tense === "participio" || tense === "perfecto") && features.participle) {
    const regularStem = getStem(inf, verb.conj);
    const regularParticiple = verb.conj === "ar" ? regularStem + "ado" : regularStem + "ido";
    const target = tense === "perfecto"
      ? `${FULL_OVERRIDE.haber.pres[PERSONS.indexOf(normPerson(person))]} ${regularParticiple}`
      : regularParticiple;
    if (norm(target) === u) tags.push("participle_irregular_missed");
  }

  if (tags.length === 0) tags.push("other");
  return tags;
}

// classifyError用: 指定語幹で規則的に活用した比較対象形を作る(簡易版)
function buildRegularComparable(verb, tense, person, stem) {
  const { conj, features = {} } = verb;
  const idx = PERSONS.indexOf(normPerson(person));
  if (tense === "pres") {
    return stem + PRES_ENDINGS[conj][idx];
  }
  if (tense === "subj") {
    const ending = SUBJ_ENDINGS[conj][idx];
    const s = features.spelling ? applySpelling(stem, features.spelling, ending[0]) : stem;
    return s + ending;
  }
  if (tense === "imp_af") {
    if (normPerson(person) === "tu") return stem + PRES_ENDINGS[conj][2]; // 3sg形
    const ending = SUBJ_ENDINGS[conj][2];
    const s = features.spelling ? applySpelling(stem, features.spelling, ending[0]) : stem;
    return s + ending;
  }
  return null;
}

// ミニ解説テンプレ差し込み用: 時制・法の日本語ラベル(内部キー -> 表示名)
const TENSE_LABELS_JA = {
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
// ミニ解説テンプレ差し込み用: 人称の日本語ラベル(内部キー -> 表示名)
const PERSON_LABELS_JA = {
  yo: "yo",
  tu: "tú",
  el: "él/ella/usted",
  nosotros: "nosotros",
  vosotros: "vosotros",
  ellos: "ellos/ellas/ustedes",
  "-": "",
};

/**
 * ErrorTag からミニ解説文を生成する(data/explanations.json を利用)。
 * @param {string[]} errorTags
 * @param {object} item
 * @param {object} explanations - data/explanations.json の内容
 * @returns {string}
 */
export function explanationFor(errorTags, item, explanations) {
  const { inf, tense, person } = item.payload;
  const answer = answerFor(item);
  const tenseLabel = tense != null ? (TENSE_LABELS_JA[tense] ?? tense) : "";
  const formLabel = person != null ? (PERSON_LABELS_JA[normPerson(person)] ?? normPerson(person)) : "";
  const lines = [];
  for (const tag of errorTags) {
    const entry = explanations && explanations.verbs && explanations.verbs[tag];
    if (entry) {
      lines.push(
        entry.template
          .replace(/\{verb\}/g, inf)
          .replace(/\{tense\}/g, tenseLabel)
          .replace(/\{form\}/g, formLabel)
          .replace(/\{correct\}/g, answer.text)
      );
    } else {
      lines.push(`正解は ${answer.text} です。`);
    }
  }
  return lines.join(" ");
}

/**
 * 過去分詞・現在分詞(人称なし)用のダミー生成。
 * 不規則形を忘れた規則形 / y挿入・pret_3rd_change忘れ / アクセント除去から構成する。
 */
function distractorsForNonPersonal(verb, tense, correct) {
  const { conj, features = {} } = verb;
  const stem = getStem(verb.inf, conj);
  const candidates = [];
  const norm = (s) => s.trim().toLowerCase();

  if (tense === "participio") {
    if (features.participle) {
      // 不規則過去分詞を忘れた規則形(participle_irregular_missed方向)
      candidates.push(conj === "ar" ? stem + "ado" : stem + "ido");
    } else {
      // 規則形: 別の活用クラスの語尾と入れ替えたダミー
      candidates.push(conj === "ar" ? stem + "ido" : stem + "ado");
    }
  } else {
    // gerundio
    if (features.pret_3rd_change) {
      candidates.push(stem + "iendo"); // durmiendo -> dormiendo(変化忘れ)
    }
    if (features.y_insert) {
      candidates.push(stem.slice(0, -1) + (conj === "ar" ? "ando" : "iendo")); // leyendo -> leiendo方向の簡易ダミー
    }
    if (!features.pret_3rd_change && !features.y_insert) {
      candidates.push(conj === "ar" ? stem + "iendo" : stem + "ando"); // 活用クラス取り違え
    }
  }

  const noAccent = stripAccents(correct);
  if (noAccent !== correct) candidates.push(noAccent);

  const result = [];
  const seen = new Set([norm(correct)]);
  for (const c of candidates) {
    if (!c) continue;
    const n = norm(c);
    if (seen.has(n)) continue;
    seen.add(n);
    result.push(c);
    if (result.length === 3) break;
  }
  // 不足分: 語尾を入れ替えた簡易ダミーで補完
  const fallbacks = [stem + "ado", stem + "ido", stem + "ando", stem + "iendo", correct + "s"];
  for (const f of fallbacks) {
    if (result.length >= 3) break;
    const n = norm(f);
    if (!seen.has(n)) {
      seen.add(n);
      result.push(f);
    }
  }
  return result.slice(0, 3);
}

/**
 * 4択ダミーを3つ生成する(SPEC 8.2 動詞)。
 * ①人称ズラし ②時制ズラし ③語幹変化を忘れた形 ④アクセント除去から3つ(重複排除)
 * @param {object} item
 * @param {{text: string}} answer
 * @returns {string[]}
 */
export function distractorsFor(item, answer) {
  const { inf, tense, person, type, subject } = item.payload;
  if (type === "gustar") {
    // gustar型は専用問題(SPEC 11.3)。単複ミス・代名詞ミス・(doler型は)語幹変化忘れ・アクセント除去を提示。
    const verb = getVerbInfo(inf);
    const features = verb.features || {};
    const pronoun = IO_PRONOUNS[normPerson(person)];
    const correctVerbForm = gustarVerbForm(inf, subject.plural);
    const oppositeVerbForm = gustarVerbForm(inf, !subject.plural);
    const norm = (s) => s.trim().toLowerCase();
    const candidates = [];

    // 単複ミス: 正しい代名詞 + 反対の単複の動詞形
    candidates.push(`${pronoun} ${oppositeVerbForm}`);

    // 代名詞ミス: 別の人称の代名詞 + 正しい動詞形
    for (const p of PERSONS) {
      if (p === normPerson(person)) continue;
      candidates.push(`${IO_PRONOUNS[p]} ${correctVerbForm}`);
    }

    // doler型(stem_change): 語幹変化を忘れた形(le dolen等)
    if (features.stem_change) {
      const regularStem = getStem(inf, verb.conj);
      const idx = subject.plural ? 5 : 2;
      const ending = PRES_ENDINGS[verb.conj][idx];
      candidates.push(`${pronoun} ${regularStem + ending}`);
    }

    // アクセント除去形
    const noAccent = stripAccents(answer.text);
    if (noAccent !== answer.text) candidates.push(noAccent);

    const result = [];
    const seen = new Set([norm(answer.text)]);
    for (const c of candidates) {
      const n = norm(c);
      if (seen.has(n)) continue;
      seen.add(n);
      result.push(c);
      if (result.length === 3) break;
    }
    return result;
  }
  const verb = getVerbInfo(inf);
  const features = verb.features || {};
  const correct = answer.text;
  const norm = (s) => s.trim().toLowerCase();
  const candidates = [];

  // participio/ger(人称なし)は専用の生成ロジック
  if (person === "-" || tense === "participio" || tense === "ger") {
    return distractorsForNonPersonal(verb, tense, correct);
  }

  // ① 人称ズラし
  if (person !== "-") {
    for (const p of PERSONS) {
      if (p === normPerson(person)) continue;
      try {
        const raw = rawForm(inf, tense, p);
        candidates.push(withReflexive(inf, tense, p, raw));
      } catch (e) {
        // skip
      }
    }
  }

  // ② 時制ズラし
  if (person !== "-") {
    for (const t of PERSONAL_TENSES) {
      if (t === tense) continue;
      try {
        const raw = rawForm(inf, t, person);
        candidates.push(withReflexive(inf, t, person, raw));
      } catch (e) {
        // skip
      }
    }
  }

  // ③ 語幹変化を忘れた形
  if (features.stem_change && person !== "-" && person !== "nosotros" && person !== "vosotros") {
    const regularStem = getStem(inf, verb.conj);
    const regularForm = buildRegularComparable(verb, tense, person, regularStem);
    if (regularForm) candidates.push(regularForm);
  }
  if (features.pret_3rd_change && tense === "pret" && (person === "el" || person === "ellos")) {
    const regularStem = getStem(inf, verb.conj);
    const ending = PRET_ENDINGS[verb.conj][PERSONS.indexOf(normPerson(person))];
    candidates.push(regularStem + ending);
  }

  // ④ アクセント除去形
  const noAccent = stripAccents(correct);
  if (noAccent !== correct) candidates.push(noAccent);

  // 重複・正解と同一を排除して3つに絞る
  const result = [];
  const seen = new Set([norm(correct)]);
  for (const c of candidates) {
    if (!c) continue;
    const n = norm(c);
    if (seen.has(n)) continue;
    seen.add(n);
    result.push(c);
    if (result.length === 3) break;
  }

  // 不足分: アクセント除去形をさらに補完(他人称形のアクセント除去等)
  let i = 0;
  while (result.length < 3 && i < candidates.length) {
    const alt = stripAccents(candidates[i] || "");
    const n = norm(alt);
    if (alt && !seen.has(n)) {
      seen.add(n);
      result.push(alt);
    }
    i++;
  }
  return result;
}

export const id = MODULE_ID;

// テスト用に内部関数を公開(js/tests.jsから利用)
export const _internal = { rawForm, conjugateAll, normPerson };

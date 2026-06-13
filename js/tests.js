// テストランナー: verbs.json の validation_cases と numbers.json の test_cases を検証する。
// Node実行: `node js/tests.js`
// ブラウザ: runAllTests(verbsData, numbersData) を import して呼び出す

import * as verbs from "./modules/verbs.js";
import * as numbers from "./modules/numbers.js";

/**
 * 動詞モジュールの validation_cases を実行する。
 * @param {object} verbsData - data/verbs.json の内容
 * @returns {{total: number, fails: Array}}
 */
export function runVerbTests(verbsData) {
  verbs.init(verbsData);
  const fails = [];
  let total = 0;

  for (const [groupName, cases] of Object.entries(verbsData.validation_cases)) {
    if (groupName.startsWith("_")) continue;
    for (const [inf, tense, person, expected] of cases) {
      total++;
      let got;
      try {
        got = verbs._internal.rawForm(inf, tense, person);
      } catch (e) {
        fails.push({ group: groupName, inf, tense, person, expected, got: `ERROR: ${e.message}` });
        continue;
      }
      if (got !== expected) {
        fails.push({ group: groupName, inf, tense, person, expected, got });
      }
    }
  }
  return { total, fails };
}

/**
 * 数字モジュールの test_cases / cases_feminine_optional を実行する。
 * @param {object} numbersData - data/numbers.json の内容
 * @returns {{total: number, fails: Array}}
 */
export function runNumberTests(numbersData) {
  numbers.init(numbersData);
  const fails = [];
  let total = 0;

  for (const [n, expected] of numbersData.test_cases.cases) {
    total++;
    const got = numbers.numToWords(n);
    if (got !== expected) fails.push({ kind: "cases", n, expected, got });
  }
  for (const [n, expected] of numbersData.test_cases.cases_feminine_optional) {
    total++;
    const got = numbers.numToWords(n, { gender: "f" });
    if (got !== expected) fails.push({ kind: "cases_feminine_optional", n, expected, got });
  }
  return { total, fails };
}

/**
 * 全テストを実行し、結果をコンソールに出力する。
 * @param {object} verbsData
 * @param {object} numbersData
 * @returns {boolean} 全件合格かどうか
 */
export function runAllTests(verbsData, numbersData) {
  const verbResult = runVerbTests(verbsData);
  const numberResult = runNumberTests(numbersData);

  console.log("=== 動詞モジュール validation_cases ===");
  console.log(`合格: ${verbResult.total - verbResult.fails.length} / ${verbResult.total}`);
  for (const f of verbResult.fails) {
    console.log(`  FAIL [${f.group}] ${f.inf} ${f.tense} ${f.person}: expected="${f.expected}" got="${f.got}"`);
  }

  console.log("=== 数字モジュール test_cases ===");
  console.log(`合格: ${numberResult.total - numberResult.fails.length} / ${numberResult.total}`);
  for (const f of numberResult.fails) {
    console.log(`  FAIL [${f.kind}] ${f.n}: expected="${f.expected}" got="${f.got}"`);
  }

  const allPass = verbResult.fails.length === 0 && numberResult.fails.length === 0;
  console.log(allPass ? "\n全件合格" : "\n失敗あり");
  return allPass;
}

// Node実行時のエントリポイント
async function main() {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const verbsData = JSON.parse(await readFile(path.join(__dirname, "..", "data", "verbs.json"), "utf-8"));
  const numbersData = JSON.parse(await readFile(path.join(__dirname, "..", "data", "numbers.json"), "utf-8"));

  const ok = runAllTests(verbsData, numbersData);
  process.exit(ok ? 0 : 1);
}

// import.meta.url を使った直接実行判定(Node ESM)
import { fileURLToPath as _fileURLToPath } from "node:url";
if (process.argv[1] && _fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

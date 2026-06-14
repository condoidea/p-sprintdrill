/* Service Worker — 西検4級 追い込みドリル
   方針:
   - ネットワーク優先 + オフライン時はキャッシュにフォールバック。
     オンラインで起動すれば常に最新を取得するため、デプロイ後に
     Safariのキャッシュ削除は不要(= 学習履歴 localStorage を消さずに更新できる)。
   - localStorage(学習履歴)には一切関与しない。SWが扱うCacheStorageとは別領域。
   - CACHE_VERSION を上げると古いCacheStorageを破棄して作り直す(通常は不要)。 */

const CACHE_VERSION = "2026-06-15";
const CACHE = `seiken4-${CACHE_VERSION}`;

// オフライン起動に必要な一式(スコープ基準の相対パス)
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/engine.js",
  "./js/ui.js",
  "./js/modules/verbs.js",
  "./js/modules/numbers.js",
  "./data/verbs.json",
  "./data/numbers.json",
  "./data/explanations.json",
];

self.addEventListener("install", (event) => {
  // 新SWを即時有効化(次回起動を待たない)
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 同一オリジンのGETのみ扱う(外部リソースは素通し。ただし当アプリは外部依存ゼロ)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ネットワーク優先: サーバと条件付きで照合し最新を取得。
  // オフライン時(fetch失敗)はキャッシュ、無ければトップページを返す。
  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match("./index.html"))
      )
  );
});

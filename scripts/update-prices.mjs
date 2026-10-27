// 抓取 CS2 市場參考價格，輸出 prices.json 給網站使用。
// 由 .github/workflows/prices.yml 定時執行；本機也可以用 `node scripts/update-prices.mjs` 測試。
import { writeFile } from "node:fs/promises";

const SKINPORT_URL = "https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0";
const RATE_URL = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_USD_TO_TWD = 32;

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "Accept": "application/json", ...headers } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

const items = await fetchJson(SKINPORT_URL, { "Accept-Encoding": "br, gzip" });
if (!Array.isArray(items) || items.length < 1000) throw new Error(`Skinport 回傳的物品數量異常：${items?.length}`);

let usdToTwd = FALLBACK_USD_TO_TWD;
try {
  const rates = await fetchJson(RATE_URL);
  const twd = Number(rates?.rates?.TWD);
  if (twd > 20 && twd < 50) usdToTwd = Math.round(twd * 1000) / 1000;
} catch (error) {
  console.warn(`匯率讀取失敗，改用預設 ${FALLBACK_USD_TO_TWD}：${error.message}`);
}

const prices = {};
for (const item of items) {
  const name = item.market_hash_name;
  const usd = Number(item.suggested_price) || Number(item.median_price) || Number(item.min_price);
  if (!name || !Number.isFinite(usd) || usd <= 0) continue;
  prices[name] = Math.round(usd * 100) / 100;
}

const output = {
  updatedAt: new Date().toISOString(),
  source: "skinport",
  currency: "USD",
  usdToTwd,
  count: Object.keys(prices).length,
  prices
};
await writeFile("prices.json", JSON.stringify(output));
console.log(`已寫入 ${output.count} 筆價格，USD→TWD ${usdToTwd}`);

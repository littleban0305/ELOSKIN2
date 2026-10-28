// ELOSKIN2 庫存讀取中繼站
// 放在家用網路（Wi-Fi 或行動網路）的舊手機上用 Termux 跑。
// 網站把「我要讀庫存」寫進 Firestore 的 inventoryRequests，這支程式收到後用手機的網路去跟 Steam 要庫存，
// 再把結果寫回 userInventories。Steam 會擋雲端主機，但不會擋一般家用網路，所以要用手機跑。
//
// 啟動：node relay.mjs（同資料夾要有 serviceAccount.json，取得方式見 README.md）

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICON_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";
const STEAM_GAP_MS = 4000; // 每次跟 Steam 要資料至少隔 4 秒，避免被限流
const RATE_LIMIT_WAIT_MS = 90 * 1000; // 被 Steam 擋（429）時休息多久
const MIN_REFETCH_MS = 2 * 60 * 1000; // 同一個人 2 分鐘內重複按，就直接用剛剛的結果
const HEARTBEAT_MS = 60 * 1000;
const MAX_PAGES = 5; // 每頁 2000 件，最多讀 10000 件
const MAX_SAVED_ITEMS = 1000; // Firestore 一份文件 1 MB 上限

// ---------- 讀取 Steam 庫存 ----------

export function toItems(assets, descriptions) {
  const byKey = new Map(descriptions.map((description) => [`${description.classid}_${description.instanceid}`, description]));
  const items = [];
  for (const asset of assets) {
    const description = byKey.get(`${asset.classid}_${asset.instanceid}`);
    if (!description || Number(description.tradable) !== 1) continue;
    const marketHashName = String(description.market_hash_name || description.name || "");
    if (!marketHashName) continue;
    items.push({
      a: String(asset.assetid),
      n: String(description.name || marketHashName).slice(0, 120),
      m: marketHashName.slice(0, 200),
      y: String(description.type || "").slice(0, 80),
      i: String(description.icon_url || "").slice(0, 400)
    });
  }
  return items;
}

export class SteamError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function fetchInventory(steamId, { fetchImpl = fetch } = {}) {
  const assets = [];
  const descriptions = [];
  let startAssetId = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `https://steamcommunity.com/inventory/${steamId}/730/2?l=tchinese&count=2000${startAssetId ? `&start_assetid=${startAssetId}` : ""}`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
      }
    });
    if (response.status === 429) throw new SteamError("rate_limited", "Steam 暫時限流，稍後自動重試");
    if (response.status === 403) throw new SteamError("private", "Steam 庫存不是公開的，請到 Steam 隱私設定把「庫存」改成公開");
    if (!response.ok) throw new SteamError("steam_error", `Steam 回應錯誤（HTTP ${response.status}）`);
    const data = await response.json().catch(() => null);
    if (!data) throw new SteamError("private", "Steam 庫存不是公開的，請到 Steam 隱私設定把「庫存」改成公開");
    if (data.success === false || data.success === 0) throw new SteamError("steam_error", "Steam 讀取失敗，請確認帳號與隱私設定");
    assets.push(...(data.assets || []));
    descriptions.push(...(data.descriptions || []));
    if (!data.more_items || !data.last_assetid) break;
    startAssetId = data.last_assetid;
    await sleep(STEAM_GAP_MS);
  }
  return { items: toItems(assets, descriptions), total: assets.length };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  const time = new Date().toLocaleString("zh-TW", { hour12: false });
  console.log(`[${time}]`, ...args);
}

// ---------- 排隊處理請求 ----------

export function createRelay({ db, fetchImpl = fetch, now = () => Date.now(), wait = sleep }) {
  const queue = [];
  const queued = new Set();
  let running = false;
  let lastSteamCall = 0;
  let handled = 0;

  async function setRequest(uid, data) {
    await db.collection("inventoryRequests").doc(uid).set(data, { merge: true });
  }

  async function handle(uid) {
    const requestRef = db.collection("inventoryRequests").doc(uid);
    const snapshot = await requestRef.get();
    const request = snapshot.exists ? snapshot.data() : null;
    if (!request || request.status !== "pending") return;
    const steamId = String(request.steamId || "");
    if (!/^\d{17}$/.test(steamId)) {
      await setRequest(uid, { status: "error", message: "Steam ID 不正確，請檢查交易連結", finishedAt: now() });
      return;
    }

    // 剛讀過就不用再跟 Steam 要
    const inventoryRef = db.collection("userInventories").doc(uid);
    const current = await inventoryRef.get();
    const saved = current.exists ? current.data() : null;
    if (saved?.steamId === steamId && now() - Number(saved.savedAt || 0) < MIN_REFETCH_MS) {
      await setRequest(uid, { status: "done", message: "", count: (saved.items || []).length, finishedAt: now() });
      return;
    }

    await setRequest(uid, { status: "working", message: "", startedAt: now() });
    const gap = lastSteamCall + STEAM_GAP_MS - now();
    if (gap > 0) await wait(gap);
    lastSteamCall = now();
    try {
      const { items, total } = await fetchInventory(steamId, { fetchImpl });
      const savedAt = now();
      await inventoryRef.set({ steamId, items: items.slice(0, MAX_SAVED_ITEMS), savedAt });
      await setRequest(uid, { status: "done", message: "", count: Math.min(items.length, MAX_SAVED_ITEMS), total, finishedAt: savedAt });
      handled += 1;
      log(`完成 ${uid}：${items.length} 件可交易（共 ${total} 件）`);
    } catch (error) {
      if (error.code === "rate_limited") {
        log("Steam 限流，休息一下再試");
        await setRequest(uid, { status: "pending", message: error.message });
        await wait(RATE_LIMIT_WAIT_MS);
        enqueue(uid);
        return;
      }
      const message = error instanceof SteamError ? error.message : `讀取失敗：${error.message}`;
      await setRequest(uid, { status: "error", message, finishedAt: now() });
      log(`失敗 ${uid}：${message}`);
    }
  }

  async function run() {
    if (running) return;
    running = true;
    while (queue.length) {
      const uid = queue.shift();
      queued.delete(uid);
      try {
        await handle(uid);
      } catch (error) {
        log(`處理 ${uid} 時出錯：`, error.message);
      }
    }
    running = false;
  }

  function enqueue(uid) {
    if (queued.has(uid)) return;
    queued.add(uid);
    queue.push(uid);
    run();
  }

  return { enqueue, handle, stats: () => ({ handled, queued: queue.length }) };
}

// ---------- 主程式 ----------

async function main() {
  const keyPath = process.env.ELOSKIN_SERVICE_ACCOUNT || join(HERE, "serviceAccount.json");
  if (!existsSync(keyPath)) {
    console.error(`找不到 ${keyPath}\n請照 README.md 從 Firebase Console 下載服務帳戶金鑰，改名成 serviceAccount.json 放在這個資料夾。`);
    process.exit(1);
  }
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const relay = createRelay({ db });
  const relayName = process.env.ELOSKIN_RELAY_NAME || os.hostname() || "phone";

  log(`庫存中繼站啟動（${relayName}），專案 ${serviceAccount.project_id}`);

  db.collection("inventoryRequests").where("status", "==", "pending").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type !== "removed") relay.enqueue(change.doc.id);
    });
  }, (error) => {
    log("監聽失敗，30 秒後重新啟動：", error.message);
    setTimeout(() => process.exit(1), 30000);
  });

  const beat = async () => {
    try {
      await db.collection("relayStatus").doc("inventory").set({ name: relayName, lastSeen: Date.now(), ...relay.stats() });
    } catch (error) {
      log("回報在線狀態失敗：", error.message);
    }
  };
  beat();
  setInterval(beat, HEARTBEAT_MS);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

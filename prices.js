// 市價：優先用 SteamAnalyst（每位使用者自己申請的免費 API 金鑰），查不到時退回 prices.json（Skinport 參考價）。
// SteamAnalyst 免費方案限制：每分鐘 30 次、24 小時內 100 次。查到的價格會存進 Firestore 的 marketPrices，大家共用，
// 別人查過的物品你就不用再花次數。
window.eloPrices = (() => {
  const TWD_PER_EC = 0.03;
  const API_URL = "https://api.steamanalyst.com/v1/prices?market_name=";
  const PER_MINUTE = 30;
  const PER_DAY = 100;
  const FRESH_MS = 24 * 60 * 60 * 1000;
  const GAP_MS = 2100; // 30 次 / 分鐘 ≈ 每 2 秒一次
  const LOCAL_CACHE = "eloskin2.saPrices";
  const KEY_PATTERN = /^sa_[A-Za-z0-9_-]{8,190}$/;

  let fallback = null; // prices.json
  let fallbackLoading = null;
  const analyst = new Map(); // name -> { usd, updatedAt }；usd 為 0 代表 SteamAnalyst 查無此物品
  const checkedRemote = new Set();
  const queue = [];
  const queued = new Set();
  let apiKey = "";
  let keyLoadedFor = "";
  let blockedUntil = 0;
  let blockReason = "";
  let lastError = "";
  let timer = null;
  let notifyTimer = null;

  // ---------- 共用工具 ----------

  function db() {
    return window.eloFirebaseDb || null;
  }

  function user() {
    const current = window.eloAuthUser;
    return current && !current.isAnonymous ? current : null;
  }

  function docId(name) {
    return encodeURIComponent(name).slice(0, 1400);
  }

  function readJson(key, fallbackValue) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch {
      return fallbackValue;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 空間不足或被封鎖就算了，只是少了本機快取
    }
  }

  function notifyChange() {
    if (notifyTimer) return;
    notifyTimer = window.setTimeout(() => {
      notifyTimer = null;
      window.dispatchEvent(new Event("elopricesloaded"));
    }, 150);
  }

  function isFresh(entry) {
    return Boolean(entry) && Date.now() - Number(entry.updatedAt || 0) < FRESH_MS;
  }

  // ---------- 本機快取 ----------

  for (const [name, entry] of Object.entries(readJson(LOCAL_CACHE, {}))) {
    if (entry && Number.isFinite(Number(entry.usd))) analyst.set(name, { usd: Number(entry.usd), updatedAt: Number(entry.updatedAt) || 0 });
  }

  function saveLocalCache() {
    const entries = [...analyst.entries()]
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 3000);
    writeJson(LOCAL_CACHE, Object.fromEntries(entries));
  }

  // ---------- 使用次數（依金鑰分開記） ----------

  function usageKey() {
    let hash = 0;
    for (const character of apiKey) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return `eloskin2.saUsage.${(hash >>> 0).toString(36)}`;
  }

  function usageLog() {
    if (!apiKey) return [];
    const now = Date.now();
    return readJson(usageKey(), []).filter((time) => Number.isFinite(time) && now - time < FRESH_MS);
  }

  function recordUsage() {
    const log = usageLog();
    log.push(Date.now());
    writeJson(usageKey(), log.slice(-PER_DAY * 2));
  }

  function waitTime() {
    const now = Date.now();
    if (blockedUntil > now) return blockedUntil - now;
    const log = usageLog();
    if (log.length >= PER_DAY) return log[log.length - PER_DAY] + FRESH_MS - now;
    const lastMinute = log.filter((time) => now - time < 60000);
    if (lastMinute.length >= PER_MINUTE) return lastMinute[lastMinute.length - PER_MINUTE] + 60000 - now;
    const last = log[log.length - 1] || 0;
    return Math.max(0, last + GAP_MS - now);
  }

  // ---------- 金鑰 ----------

  async function loadKey() {
    const current = user();
    const uid = current?.uid || "";
    if (keyLoadedFor === uid) return;
    keyLoadedFor = uid;
    apiKey = "";
    blockedUntil = 0;
    blockReason = "";
    lastError = "";
    if (uid && db()) {
      try {
        const snapshot = await db().collection("userSecrets").doc(uid).get();
        if (keyLoadedFor !== uid) return;
        apiKey = String(snapshot.data()?.steamAnalystKey || "");
      } catch (error) {
        console.warn("Price key unavailable:", error);
      }
    }
    notifyChange();
    schedule();
  }

  async function saveKey(rawKey) {
    const current = user();
    if (!current || !db()) throw new Error("login");
    const key = String(rawKey || "").trim();
    if (key && !KEY_PATTERN.test(key)) throw new Error("format");
    await db().collection("userSecrets").doc(current.uid).set({ steamAnalystKey: key, updatedAt: Date.now() });
    apiKey = key;
    keyLoadedFor = current.uid;
    blockedUntil = 0;
    blockReason = "";
    lastError = "";
    notifyChange();
    schedule();
  }

  // ---------- 共用的 Firestore 價格快取 ----------

  async function fetchShared(names) {
    const database = db();
    if (!database) return;
    const missing = names.filter((name) => !checkedRemote.has(name) && !isFresh(analyst.get(name)));
    if (!missing.length) return;
    missing.forEach((name) => checkedRemote.add(name));
    let changed = 0;
    for (let index = 0; index < missing.length; index += 20) {
      const chunk = missing.slice(index, index + 20);
      const snapshots = await Promise.all(chunk.map((name) => database.collection("marketPrices").doc(docId(name)).get().catch(() => null)));
      snapshots.forEach((snapshot, position) => {
        const data = snapshot?.exists ? snapshot.data() : null;
        if (!data || !Number.isFinite(Number(data.usd))) return;
        const name = chunk[position];
        const known = analyst.get(name);
        if (!known || Number(data.updatedAt) > known.updatedAt) {
          analyst.set(name, { usd: Number(data.usd), updatedAt: Number(data.updatedAt) || 0 });
          changed += 1;
        }
      });
    }
    if (!changed) return;
    saveLocalCache();
    notifyChange();
  }

  function storeShared(name, usd) {
    const current = user();
    const database = db();
    if (!current || !database) return;
    database.collection("marketPrices").doc(docId(name)).set({
      name,
      usd,
      source: "steamanalyst",
      updatedAt: Date.now(),
      updatedBy: current.uid
    }).catch((error) => console.warn("Price cache write failed:", error));
  }

  // ---------- 排隊向 SteamAnalyst 查價 ----------

  function schedule() {
    if (timer || !apiKey || !queue.length) return;
    timer = window.setTimeout(() => {
      timer = null;
      pump();
    }, waitTime());
  }

  async function pump() {
    if (!apiKey) return;
    while (queue.length && isFresh(analyst.get(queue[0]))) queued.delete(queue.shift());
    if (!queue.length) {
      notifyChange();
      return;
    }
    if (waitTime() > 0) {
      schedule();
      return;
    }
    const name = queue.shift();
    queued.delete(name);
    recordUsage();
    try {
      const response = await fetch(API_URL + encodeURIComponent(name), {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success && Number.isFinite(Number(body.data?.price))) {
        const usd = Math.max(0, Number(body.data.price));
        analyst.set(name, { usd, updatedAt: Date.now() });
        storeShared(name, usd);
        lastError = "";
      } else {
        const code = body?.error?.code || `HTTP_${response.status}`;
        if (code === "ITEM_NOT_FOUND") {
          analyst.set(name, { usd: 0, updatedAt: Date.now() });
          storeShared(name, 0);
        } else if (code === "RATE_LIMIT_EXCEEDED") {
          queue.unshift(name);
          queued.add(name);
          blockedUntil = Date.now() + 60000;
          blockReason = "minute";
        } else if (code === "DAILY_LIMIT_EXCEEDED") {
          queue.unshift(name);
          queued.add(name);
          blockedUntil = Date.now() + 60 * 60 * 1000;
          blockReason = "daily";
        } else if (code === "INVALID_KEY" || code === "MISSING_AUTH" || code === "EXPIRED_KEY" || code === "IP_NOT_WHITELISTED") {
          queue.unshift(name);
          queued.add(name);
          blockedUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;
          blockReason = "key";
        }
        lastError = code;
      }
    } catch (error) {
      queue.unshift(name);
      queued.add(name);
      blockedUntil = Date.now() + 30000;
      blockReason = "network";
      lastError = error.message;
    }
    saveLocalCache();
    notifyChange();
    schedule();
  }

  // 頁面把「現在看得到的物品」交給這裡；已經有新鮮價格的不會再查
  function request(names) {
    const unique = [...new Set((names || []).map((name) => String(name || "").trim()).filter(Boolean))];
    if (!unique.length) return;
    load();
    fetchShared(unique).catch(() => {}).finally(() => {
      let added = 0;
      for (const name of unique) {
        if (isFresh(analyst.get(name)) || queued.has(name)) continue;
        queued.add(name);
        queue.push(name);
        added += 1;
      }
      if (!added) return;
      notifyChange();
      schedule();
    });
  }

  // ---------- prices.json 備用價 ----------

  function load() {
    if (!fallbackLoading) {
      const hourKey = new Date().toISOString().slice(0, 13);
      fallbackLoading = fetch(`prices.json?h=${hourKey}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          if (json && json.prices && Number(json.usdToTwd) > 0) {
            fallback = json;
            notifyChange();
          }
          return fallback;
        })
        .catch((error) => {
          console.warn("Prices unavailable:", error);
          fallbackLoading = null;
          return null;
        });
    }
    return fallbackLoading;
  }

  function usdToTwd() {
    return Number(fallback?.usdToTwd) > 0 ? Number(fallback.usdToTwd) : 32;
  }

  // 回傳 { usd, source: "steamanalyst" | "skinport" }，沒有價格回傳 null
  function quote(marketHashName) {
    const entry = analyst.get(marketHashName);
    if (entry && entry.usd > 0) return { usd: entry.usd, source: "steamanalyst" };
    const usd = Number(fallback?.prices?.[marketHashName]);
    if (Number.isFinite(usd) && usd > 0) return { usd, source: "skinport" };
    return null;
  }

  function twd(marketHashName) {
    const found = quote(marketHashName);
    return found ? Math.round(found.usd * usdToTwd() * 100) / 100 : null;
  }

  function ec(marketHashName) {
    const value = twd(marketHashName);
    return value === null ? null : Math.max(1, Math.round(value / TWD_PER_EC));
  }

  function source(marketHashName) {
    return quote(marketHashName)?.source || "";
  }

  function pending(marketHashName) {
    return queued.has(marketHashName);
  }

  function loaded() {
    return Boolean(fallback) || analyst.size > 0;
  }

  function updatedLabel() {
    if (!fallback?.updatedAt) return "";
    return new Date(fallback.updatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function status() {
    const log = usageLog();
    const now = Date.now();
    return {
      hasKey: Boolean(apiKey),
      maskedKey: apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : "",
      usedToday: log.length,
      dailyLimit: PER_DAY,
      usedThisMinute: log.filter((time) => now - time < 60000).length,
      minuteLimit: PER_MINUTE,
      queued: queue.length,
      blockedReason: blockedUntil > now ? blockReason : "",
      resumeAt: blockedUntil > now ? blockedUntil : (log.length >= PER_DAY ? log[log.length - PER_DAY] + FRESH_MS : 0),
      lastError
    };
  }

  window.addEventListener("eloauthchange", loadKey);
  window.addEventListener("elofirebaseready", () => {
    keyLoadedFor = null;
    loadKey();
  });

  return { load, request, twd, ec, source, pending, loaded, updatedLabel, status, saveKey };
})();

// 市價只用 SteamAnalyst（每位使用者自己申請的免費 API 金鑰），不再用其他備用價。
// 免費方案限制：每分鐘 30 次、24 小時內 100 次。查到的價格存進 Firestore 的 marketPrices 大家共用，
// 別人查過的物品你就不用再花次數。金鑰會自動存到雲端（userSecrets），申請後在 SteamAnalyst 看不到第二次，雲端那份就是備份。
window.eloPrices = (() => {
  const TWD_PER_EC = 0.03;
  const API_URL = "https://api.steamanalyst.com/v1/prices?market_name=";
  const PER_MINUTE = 30;
  const PER_DAY = 100;
  const FRESH_MS = 24 * 60 * 60 * 1000;
  const GAP_MS = 2100; // 30 次 / 分鐘 ≈ 每 2 秒一次
  const LOCAL_CACHE = "eloskin2.saPrices";
  const KEY_PATTERN = /^sa_[A-Za-z0-9_-]{8,190}$/;

  const RATE_URL = "https://open.er-api.com/v6/latest/USD";
  const RATE_CACHE = "eloskin2.usdTwd";
  let usdTwd = Number(readJsonEarly(RATE_CACHE)?.rate) || 32;
  let rateLoading = null;
  const analyst = new Map(); // name -> { usd, updatedAt }；usd 為 0 代表 SteamAnalyst 查無此物品
  const checkedRemote = new Set();
  const queue = [];
  const queued = new Set();
  let apiKey = "";
  let keyLoadedFor = "";
  let keyReady = false;
  let syncState = ""; // "cloud"：雲端有備份；"local"：只在這台裝置，會自動重試上傳
  let syncTimer = null;
  let blockedUntil = 0;
  let blockReason = "";
  let lastError = "";
  let timer = null;
  let notifyTimer = null;

  // ---------- 共用工具 ----------

  function readJsonEarly(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

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
    if (keyLoadedFor === uid && keyReady) return;
    keyLoadedFor = uid;
    keyReady = false;
    apiKey = "";
    syncState = "";
    blockedUntil = 0;
    blockReason = "";
    lastError = "";
    const localKey = uid ? String(readJson(localKeyName(uid), "") || "") : "";
    apiKey = localKey;
    if (uid && db()) {
      try {
        const snapshot = await db().collection("userSecrets").doc(uid).get();
        if (keyLoadedFor !== uid) return;
        const remoteKey = String(snapshot.data()?.steamAnalystKey || "");
        if (remoteKey) {
          apiKey = remoteKey;
          syncState = "cloud";
          writeJson(localKeyName(uid), remoteKey);
        } else if (localKey) {
          // 雲端還沒有（之前規則沒發布時存的），自動補上傳
          syncState = "local";
          syncToCloud();
        }
      } catch (error) {
        console.warn("Price key unavailable:", error);
        if (localKey) {
          syncState = "local";
          retrySyncLater();
        }
      }
    } else if (localKey) syncState = "local";
    if (keyLoadedFor !== uid) return;
    keyReady = Boolean(uid);
    notifyChange();
    schedule();
  }

  async function syncToCloud() {
    const current = user();
    if (!current || !db() || !apiKey) return false;
    try {
      await db().collection("userSecrets").doc(current.uid).set({ steamAnalystKey: apiKey, updatedAt: Date.now() });
      syncState = "cloud";
      notifyChange();
      return true;
    } catch (error) {
      console.warn("Price key sync failed:", error);
      syncState = "local";
      retrySyncLater();
      notifyChange();
      return false;
    }
  }

  function retrySyncLater() {
    if (syncTimer) return;
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      if (syncState === "local") syncToCloud();
    }, 60000);
  }

  async function saveKey(rawKey) {
    const current = user();
    if (!current || !db()) throw new Error("login");
    const key = String(rawKey || "").trim();
    if (!KEY_PATTERN.test(key)) throw new Error("format");
    writeJson(localKeyName(current.uid), key);
    apiKey = key;
    keyLoadedFor = current.uid;
    keyReady = true;
    blockedUntil = 0;
    blockReason = "";
    lastError = "";
    const synced = await syncToCloud();
    notifyChange();
    schedule();
    return { synced };
  }

  function localKeyName(uid) {
    return `eloskin2.saKey.${uid}`;
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

  // ---------- 美元匯率（換算台幣用） ----------

  function load() {
    if (!rateLoading) {
      const cached = readJson(RATE_CACHE, null);
      if (cached && Date.now() - Number(cached.at) < 12 * 60 * 60 * 1000) {
        rateLoading = Promise.resolve(usdTwd);
      } else {
        rateLoading = fetch(RATE_URL)
          .then((response) => (response.ok ? response.json() : null))
          .then((json) => {
            const rate = Number(json?.rates?.TWD);
            if (rate > 20 && rate < 50) {
              usdTwd = rate;
              writeJson(RATE_CACHE, { rate, at: Date.now() });
              notifyChange();
            }
            return usdTwd;
          })
          .catch(() => {
            rateLoading = null;
            return usdTwd;
          });
      }
    }
    return rateLoading;
  }

  function usdToTwd() {
    return usdTwd;
  }

  // 回傳 { usd, source: "steamanalyst" | "skinport" }，沒有價格回傳 null
  function quote(marketHashName) {
    const entry = analyst.get(marketHashName);
    return entry && entry.usd > 0 ? { usd: entry.usd, source: "steamanalyst" } : null;
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

  // 查過了但 SteamAnalyst 沒有這個物品
  function missing(marketHashName) {
    const entry = analyst.get(marketHashName);
    return Boolean(entry) && entry.usd <= 0;
  }

  function loaded() {
    return analyst.size > 0;
  }

  function updatedLabel() {
    return "";
  }

  function fullKey() {
    return apiKey;
  }

  function status() {
    const log = usageLog();
    const now = Date.now();
    return {
      hasKey: Boolean(apiKey),
      keyReady,
      syncState,
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

  load();

  return { load, request, twd, ec, source, pending, missing, loaded, updatedLabel, status, saveKey, fullKey };
})();

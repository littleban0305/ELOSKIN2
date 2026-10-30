// ELOSKIN2 Steam 交易機器人
// 跟庫存中繼站放在同一台手機，用 Termux 跑：node bot.mjs
// 需要同資料夾的 serviceAccount.json（跟中繼站共用）和 bot-config.json（機器人帳號，設定方式見 README.md）
// 帳號密碼、驗證器密鑰只存在這台手機，不會上傳到任何地方。

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import os from "node:os";
import { createBot } from "./bot-core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "bot-data");
const TOKEN_FILE = join(DATA_DIR, "refresh-token.txt");
const POLL_FILE = join(DATA_DIR, "poll-data.json");
const HEARTBEAT_MS = 60 * 1000;

function log(...args) {
  const time = new Date().toLocaleString("zh-TW", { hour12: false });
  console.log(`[${time}] [機器人]`, ...args);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${what}讀取失敗（${path}）：${error.message}`);
  }
}

// ---------- 設定 ----------

function loadConfig() {
  const configPath = join(HERE, "bot-config.json");
  if (!existsSync(configPath)) fail("找不到 bot-config.json，請照 README.md 的「交易機器人」步驟建立。");
  const config = readJson(configPath, "bot-config.json ");
  let maFile = {};
  if (config.maFile) {
    const maPath = isAbsolute(config.maFile) ? config.maFile : join(HERE, config.maFile);
    if (!existsSync(maPath)) fail(`找不到 maFile：${maPath}`);
    const raw = readFileSync(maPath, "utf8");
    try {
      maFile = JSON.parse(raw);
    } catch {
      fail("maFile 打不開，可能有加密。請在 Steam Desktop Authenticator 的設定裡移除加密（Manage Encryption → 留空）再重新複製。");
    }
  }
  const account = {
    accountName: String(config.accountName || maFile.account_name || ""),
    password: String(config.password || ""),
    sharedSecret: String(config.sharedSecret || maFile.shared_secret || ""),
    identitySecret: String(config.identitySecret || maFile.identity_secret || "")
  };
  if (!account.accountName) fail("bot-config.json 缺少 accountName（或 maFile 裡的 account_name）");
  // 沒有 maFile 也能跑（半自動模式）：登入時輸入一次 Steam App 上的驗證碼，送出的報價要自己到 Steam App 按確認
  if (!account.password && !existsSync(TOKEN_FILE)) fail("bot-config.json 缺少 password（第一次登入需要）");
  return {
    account,
    autoPurchase: config.autoPurchase !== false,
    offerTimeoutMinutes: Math.max(10, Number(config.offerTimeoutMinutes) || 24 * 60),
    ownerSteamIds: Array.isArray(config.ownerSteamIds) ? config.ownerSteamIds.map(String) : [],
    declineUnknownOffers: config.declineUnknownOffers === undefined ? Boolean(account.identitySecret) : config.declineUnknownOffers !== false,
    name: String(config.name || process.env.ELOSKIN_RELAY_NAME || os.hostname() || "phone")
  };
}

// ---------- Steam ----------

const STATE_NAMES = {
  Active: "sent",
  Accepted: "accepted",
  Countered: "countered",
  Expired: "expired",
  Canceled: "canceled",
  Declined: "declined",
  InvalidItems: "invalid",
  CreatedNeedsConfirmation: "confirming",
  CanceledBySecondFactor: "canceled_2fa",
  InEscrow: "escrow"
};

function userError(message) {
  return Object.assign(new Error(message), { userFault: true });
}

function explainSendError(error) {
  const eresult = Number(error?.eresult);
  if (eresult === 15) return userError("機器人沒辦法送交易給你：交易連結可能失效、Steam 帳號被限制交易，或庫存不是公開的。請到「設定」確認交易連結後再下單");
  if (eresult === 25) return new Error("對方或機器人的庫存滿了");
  if (eresult === 26) return new Error("有物品已經不在庫存裡了");
  if (eresult === 16 || eresult === 20) return new Error("Steam 暫時連不上，稍後再試");
  return new Error(error?.message || "未知錯誤");
}

async function main() {
  const config = loadConfig();
  const keyPath = process.env.ELOSKIN_SERVICE_ACCOUNT || join(HERE, "serviceAccount.json");
  if (!existsSync(keyPath)) fail(`找不到 ${keyPath}（跟中繼站用同一個服務帳戶金鑰）`);
  mkdirSync(DATA_DIR, { recursive: true });

  const [{ default: SteamUser }, { default: SteamCommunity }, { default: TradeOfferManager }, { default: SteamTotp }] = await Promise.all([
    import("steam-user"), import("steamcommunity"), import("steam-tradeoffer-manager"), import("steam-totp")
  ]);
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  initializeApp({ credential: cert(readJson(keyPath, "服務帳戶金鑰")) });
  const db = getFirestore();

  const stateName = (state) => STATE_NAMES[TradeOfferManager.ETradeOfferState[state]] || "sent";
  const { account } = config;

  const client = new SteamUser({ dataDirectory: DATA_DIR, renewRefreshTokens: true, autoRelogin: true });
  const community = new SteamCommunity();
  const manager = new TradeOfferManager({
    steam: client,
    community,
    language: "tchinese",
    pollInterval: 30 * 1000,
    cancelTime: config.offerTimeoutMinutes * 60 * 1000,
    // 半自動模式要等你在 Steam App 確認，等久一點
    pendingCancelTime: account.identitySecret ? 30 * 60 * 1000 : config.offerTimeoutMinutes * 60 * 1000,
    useAccessToken: true,
    pollData: existsSync(POLL_FILE) ? readJson(POLL_FILE, "poll-data.json ") : undefined
  });
  let ready = false;
  let usingToken = false;

  const call = (fn) => new Promise((resolve, reject) => fn((error, ...values) => (error ? reject(error) : resolve(values))));

  async function confirm(offerId) {
    if (!account.identitySecret) return false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await call((done) => community.acceptConfirmationForObject(account.identitySecret, offerId, done));
        return true;
      } catch (error) {
        log(`確認報價 ${offerId} 失敗（第 ${attempt} 次）：`, error.message);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    return false;
  }

  const steam = {
    ready: () => ready,
    steamId: () => client.steamID?.getSteamID64() || "",
    async getInventory() {
      const [items] = await call((done) => manager.getInventoryContents(730, 2, true, done));
      return items.map((item) => ({ assetid: String(item.assetid), marketHashName: String(item.market_hash_name || "") }));
    },
    async sendOffer({ tradeUrl, give, receive, message }) {
      let offer;
      try {
        offer = manager.createOffer(tradeUrl);
      } catch {
        throw userError("Steam 交易連結格式不正確，請到「設定」重新貼上交易連結後再下單");
      }
      let me, them;
      try {
        [me, them] = await call((done) => offer.getUserDetails(done));
      } catch (error) {
        throw explainSendError(error);
      }
      if (them?.escrowDays > 0) {
        throw userError(`你的 Steam 交易會被暫留 ${them.escrowDays} 天（通常是 Steam 手機驗證器還沒開滿 7 天）。開好驗證器之後再下單就能馬上收到`);
      }
      if (me?.escrowDays > 0) throw new Error(`機器人帳號的交易會被暫留 ${me.escrowDays} 天，請檢查機器人的手機驗證器`);
      give.forEach((assetid) => offer.addMyItem({ appid: 730, contextid: "2", assetid }));
      receive.forEach((assetid) => offer.addTheirItem({ appid: 730, contextid: "2", assetid }));
      offer.setMessage(message);
      let status;
      try {
        [status] = await call((done) => offer.send(done));
      } catch (error) {
        throw explainSendError(error);
      }
      if (status === "pending") {
        const confirmed = await confirm(offer.id);
        if (!confirmed) {
          return { offerId: offer.id, state: "confirming", message: account.identitySecret ? "報價已建立，但機器人的手機確認失敗，請到 Steam App 確認" : "請到 Steam App 的「確認」按確認這筆交易報價" };
        }
      }
      return { offerId: offer.id, state: "sent" };
    },
    async cancelOffer(offerId) {
      const [offer] = await call((done) => manager.getOffer(offerId, done));
      await call((done) => offer.cancel(done));
    },
    async getOfferState(offerId) {
      const [offer] = await call((done) => manager.getOffer(offerId, done));
      return stateName(offer.state);
    }
  };

  const bot = createBot({
    db,
    steam,
    FieldValue,
    log,
    config: {
      ...config,
      onWatchError: () => setTimeout(() => process.exit(1), 30000)
    }
  });

  // ---------- Steam 事件 ----------

  manager.on("pollData", (data) => {
    try {
      writeFileSync(POLL_FILE, JSON.stringify(data));
    } catch (error) {
      log("存 poll-data 失敗：", error.message);
    }
  });

  manager.on("sentOfferChanged", (offer) => {
    bot.onOfferChanged(offer.id, stateName(offer.state)).catch((error) => log("更新報價狀態失敗：", error.message));
  });

  manager.on("sentOfferCanceled", (offer, reason) => {
    bot.onOfferChanged(offer.id, reason === "cancelTime" ? "expired" : "canceled").catch((error) => log("更新報價狀態失敗：", error.message));
  });

  manager.on("sentPendingOfferCanceled", (offer) => {
    bot.onOfferChanged(offer.id, "canceled").catch((error) => log("更新報價狀態失敗：", error.message));
  });

  manager.on("newOffer", (offer) => {
    const partner = offer.partner.getSteamID64();
    const decision = bot.decideIncoming({ partner, giving: offer.itemsToGive.length, receiving: offer.itemsToReceive.length });
    if (decision === "accept") {
      offer.accept(async (error, status) => {
        if (error) return log(`收下補貨報價 ${offer.id} 失敗：`, error.message);
        if (status === "pending") await confirm(offer.id);
        log(`收下 ${partner} 送來的 ${offer.itemsToReceive.length} 件物品`);
        setTimeout(() => bot.requestInventoryRefresh("admin", steam.steamId()), 15000);
      });
    } else if (decision === "decline") {
      offer.decline((error) => log(error ? `拒絕報價 ${offer.id} 失敗：${error.message}` : `拒絕了 ${partner} 的報價 ${offer.id}`));
    }
  });

  // ---------- 登入 ----------
  // 規則：
  //   1. 背景執行（start.sh）時只用記住的登入狀態（bot-data/refresh-token.txt）。
  //      半自動模式絕對不會自己用帳號密碼登入，避免 Steam App 一直跳登入要求。
  //   2. 登入狀態失效就停下來，等你在 Termux 執行 node bot.mjs --login 手動登入一次；
  //      程式不結束（start.sh 才不會一直重開），管理頁會顯示「需要重新登入」。
  //   3. 網路、Steam 暫時出錯就慢慢重試（1、2、5、10、30 分鐘）。

  const LOGIN_MODE = process.argv.includes("--login");
  const interactive = Boolean(process.stdin.isTTY);
  const canUsePassword = Boolean(account.password) && (Boolean(account.sharedSecret) || (LOGIN_MODE && interactive));
  const RETRY_MINUTES = [1, 2, 5, 10, 30];
  const AUTH_ERRORS = new Set([5, 15, 18, 27, 63, 65, 66, 85, 88]); // 密碼錯、拒絕、過期、需要驗證碼等
  let retries = 0;
  let retryTimer = null;
  let halted = "";

  // 暫停登入；之後只要 node bot.mjs --login 存好新的登入狀態，這裡一分鐘內會自己接著跑，不用重開
  let resumeTimer = null;
  function halt(message) {
    halted = message;
    ready = false;
    clearTimeout(retryTimer);
    log(`暫停：${message}`);
    beat();
    if (LOGIN_MODE || resumeTimer) return;
    resumeTimer = setInterval(() => {
      if (!existsSync(TOKEN_FILE)) return;
      clearInterval(resumeTimer);
      resumeTimer = null;
      halted = "";
      retries = 0;
      log("看到新的登入狀態，繼續");
      try { client.logOff(); } catch { /* 本來就沒登入 */ }
      setTimeout(logOn, 3000);
    }, 60 * 1000);
  }

  function scheduleRetry(minutes) {
    clearTimeout(retryTimer);
    const wait = minutes ?? RETRY_MINUTES[Math.min(retries, RETRY_MINUTES.length - 1)];
    retries += 1;
    log(`${wait} 分鐘後重新登入`);
    retryTimer = setTimeout(logOn, wait * 60 * 1000);
  }

  function logOn() {
    if (halted) return;
    if (existsSync(TOKEN_FILE)) {
      usingToken = true;
      client.logOn({ refreshToken: readFileSync(TOKEN_FILE, "utf8").trim(), machineName: "ELOSKIN2 bot" });
      return;
    }
    if (!canUsePassword) {
      halt("需要手動登入一次：在 Termux 執行 node bot.mjs --login");
      return;
    }
    usingToken = false;
    const details = { accountName: account.accountName, password: account.password, machineName: "ELOSKIN2 bot" };
    if (account.sharedSecret) details.twoFactorCode = SteamTotp.generateAuthCode(account.sharedSecret);
    client.logOn(details);
  }

  client.on("steamGuard", async (domain, callback, lastCodeWrong) => {
    if (account.sharedSecret && !domain) {
      if (lastCodeWrong && retries > 2) return halt("驗證器的代碼一直被拒絕，請檢查 maFile");
      setTimeout(() => callback(SteamTotp.generateAuthCode(account.sharedSecret)), lastCodeWrong ? 30000 : 0);
      return;
    }
    if (!interactive) return halt("需要手動登入一次：在 Termux 執行 node bot.mjs --login");
    const { createInterface } = await import("node:readline/promises");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const where = domain ? `寄到 ${domain} 的電子郵件` : "手機 Steam App（Steam Guard）";
    const code = await prompt.question(`${lastCodeWrong ? "驗證碼錯了，" : ""}請輸入${where}上的驗證碼：`);
    prompt.close();
    callback(code.trim());
  });

  client.on("refreshToken", (token) => {
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    if (LOGIN_MODE) {
      log("登入成功，已經記住登入狀態。現在可以用 ./start.sh 啟動了");
      setTimeout(() => process.exit(0), 2000);
    }
  });

  client.on("loggedOn", () => {
    retries = 0;
    log(`已登入 Steam（${client.steamID.getSteamID64()}）`);
    // 專用機器人帳號才顯示上線；用主帳號（半自動）就不動你的線上狀態
    if (account.sharedSecret) client.setPersona(SteamUser.EPersonaState.Online);
    if (LOGIN_MODE && usingToken) {
      log("已經是登入狀態，不用再登入。可以用 ./start.sh 啟動了");
      setTimeout(() => process.exit(0), 1000);
    }
  });

  client.on("webSession", (sessionId, cookies) => {
    if (LOGIN_MODE) return;
    community.setCookies(cookies);
    manager.setCookies(cookies, (error) => {
      if (error) {
        log("交易功能啟動失敗：", error.message);
        return;
      }
      const firstTime = !ready;
      ready = true;
      if (firstTime) {
        log(`交易功能就緒，${config.autoPurchase ? "購買訂單會自動送出" : "只處理管理員交給機器人的訂單"}`);
        if (!account.identitySecret) log("半自動模式：送出的報價要到手機 Steam App →「確認」按確認，買家才收得到");
      }
      bot.onSteamReady();
    });
  });

  community.on("sessionExpired", () => {
    if (!ready) return;
    log("Steam 網頁登入過期，重新取得");
    client.webLogOn();
  });

  client.on("disconnected", () => {
    ready = false;
    log("跟 Steam 斷線了，會自動重連");
  });

  client.on("error", (error) => {
    ready = false;
    const eresult = Number(error.eresult);
    log(`Steam 登入出錯（${eresult || "?"}）：${error.message}`);
    if (LOGIN_MODE) {
      console.error("登入失敗，請確認帳號密碼後再試一次");
      process.exit(1);
    }
    if (eresult === 6 || eresult === 34) return scheduleRetry(10); // 在別的地方登入
    if (eresult === 84 || eresult === 87) return scheduleRetry(30); // 登入太頻繁
    if (AUTH_ERRORS.has(eresult) || /token|password|denied|expired/i.test(error.message)) {
      if (usingToken) {
        try { unlinkSync(TOKEN_FILE); } catch { /* 沒有就算了 */ }
      }
      if (canUsePassword && retries < 3) return scheduleRetry(1);
      return halt("登入狀態失效了，需要手動登入一次：在 Termux 執行 node bot.mjs --login");
    }
    scheduleRetry();
  });

  // ---------- 啟動 ----------

  async function beat() {
    if (LOGIN_MODE) return;
    try {
      await db.collection("relayStatus").doc("bot").set({
        name: config.name,
        lastSeen: Date.now(),
        loggedIn: ready,
        needsLogin: Boolean(halted),
        message: halted,
        steamId: steam.steamId(),
        autoPurchase: config.autoPurchase,
        ...bot.stats()
      });
    } catch (error) {
      log("回報在線狀態失敗：", error.message);
    }
  }

  if (LOGIN_MODE) {
    if (!interactive) fail("node bot.mjs --login 要在 Termux 裡直接執行");
    if (!account.password) fail("bot-config.json 要填 password 才能登入");
    try { unlinkSync(TOKEN_FILE); } catch { /* 沒有就算了 */ }
    log("開始登入，Steam 可能會問驗證碼，或在 Steam App 跳出登入確認");
  } else {
    bot.watch();
    setInterval(beat, HEARTBEAT_MS);
    beat();
  }
  logOn();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

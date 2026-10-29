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
  if (!account.sharedSecret || !account.identitySecret) fail("缺少 shared_secret 或 identity_secret，請確認 maFile 路徑");
  if (!account.password && !existsSync(TOKEN_FILE)) fail("bot-config.json 缺少 password（第一次登入需要）");
  return {
    account,
    autoPurchase: config.autoPurchase !== false,
    offerTimeoutMinutes: Math.max(10, Number(config.offerTimeoutMinutes) || 24 * 60),
    ownerSteamIds: Array.isArray(config.ownerSteamIds) ? config.ownerSteamIds.map(String) : [],
    declineUnknownOffers: config.declineUnknownOffers !== false,
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
    pendingCancelTime: 30 * 60 * 1000,
    useAccessToken: true,
    pollData: existsSync(POLL_FILE) ? readJson(POLL_FILE, "poll-data.json ") : undefined
  });
  let ready = false;
  let usingToken = false;

  const call = (fn) => new Promise((resolve, reject) => fn((error, ...values) => (error ? reject(error) : resolve(values))));

  async function confirm(offerId) {
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
        if (!confirmed) return { offerId: offer.id, state: "confirming", message: "報價已建立，但機器人的手機確認失敗，請到機器人帳號確認" };
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

  function logOn() {
    if (existsSync(TOKEN_FILE)) {
      usingToken = true;
      client.logOn({ refreshToken: readFileSync(TOKEN_FILE, "utf8").trim(), machineName: "ELOSKIN2 bot" });
    } else {
      usingToken = false;
      client.logOn({ accountName: account.accountName, password: account.password, twoFactorCode: SteamTotp.generateAuthCode(account.sharedSecret), machineName: "ELOSKIN2 bot" });
    }
  }

  client.on("steamGuard", (domain, callback, lastCodeWrong) => {
    if (domain) return fail("Steam 要求電子郵件驗證碼，代表這個帳號沒有開手機驗證器。請先用 Steam Desktop Authenticator 綁定。");
    setTimeout(() => callback(SteamTotp.generateAuthCode(account.sharedSecret)), lastCodeWrong ? 30000 : 0);
  });

  client.on("refreshToken", (token) => {
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  });

  client.on("loggedOn", () => {
    log(`已登入 Steam（${client.steamID.getSteamID64()}）`);
    client.setPersona(SteamUser.EPersonaState.Online);
  });

  client.on("webSession", (sessionId, cookies) => {
    community.setCookies(cookies);
    manager.setCookies(cookies, (error) => {
      if (error) {
        log("交易功能啟動失敗：", error.message);
        return;
      }
      const firstTime = !ready;
      ready = true;
      if (firstTime) log(`交易功能就緒，${config.autoPurchase ? "購買訂單會自動送出" : "只處理管理員交給機器人的訂單"}`);
      bot.onSteamReady();
    });
  });

  community.on("sessionExpired", () => {
    log("Steam 網頁登入過期，重新登入");
    client.webLogOn();
  });

  client.on("disconnected", () => {
    ready = false;
    log("跟 Steam 斷線了，會自動重連");
  });

  client.on("error", (error) => {
    ready = false;
    if (usingToken) {
      log("用記住的登入狀態登入失敗，改用帳號密碼：", error.message);
      try { unlinkSync(TOKEN_FILE); } catch { /* 沒有就算了 */ }
      if (!account.password) fail("bot-config.json 沒有 password，沒辦法重新登入");
      setTimeout(logOn, 5000);
      return;
    }
    log("Steam 登入失敗：", error.message);
    setTimeout(() => process.exit(1), 60000); // start.sh 會在一分鐘後重開
  });

  // ---------- 啟動 ----------

  bot.watch();
  logOn();

  const beat = async () => {
    try {
      await db.collection("relayStatus").doc("bot").set({
        name: config.name,
        lastSeen: Date.now(),
        loggedIn: ready,
        steamId: steam.steamId(),
        autoPurchase: config.autoPurchase,
        ...bot.stats()
      });
    } catch (error) {
      log("回報在線狀態失敗：", error.message);
    }
  };
  beat();
  setInterval(beat, HEARTBEAT_MS);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

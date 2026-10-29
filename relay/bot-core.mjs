// ELOSKIN2 Steam 交易機器人：訂單邏輯（不直接碰 Steam，方便測試）
// bot.mjs 負責登入 Steam，再把「送報價、讀庫存、取消報價」這些動作傳進來。
//
// 流程：
//   1. 購買訂單（只用 EC 付款、商品都是從 Steam 庫存上架的）→ 機器人自己接單、送出交易報價
//   2. 交易訂單（買家也要給物品）→ 管理員在管理頁按「交給機器人」後才送
//   3. 買家在 Steam 接受 → 機器人把訂單改成已完成、扣 EC、扣庫存、寫錢包紀錄、通知
//   4. 拒絕／逾時／取消 → 訂單取消，不扣 EC
// 做不到的（自訂商品、機器人庫存找不到物品、Steam 出錯）會標成「需要手動處理」，交給管理員。

export const ACTIVE_STATES = ["sending", "confirming", "sent", "escrow"];

const FAIL_MESSAGES = {
  declined: "你在 Steam 拒絕了交易報價，訂單已取消，沒有扣 EC",
  canceled: "交易報價被取消了，訂單已取消，沒有扣 EC",
  expired: "交易報價太久沒有接受，已自動收回，訂單已取消，沒有扣 EC",
  invalid: "有物品已經不在庫存裡，交易報價失效，訂單已取消，沒有扣 EC",
  countered: "交易報價被還價了，機器人不接受還價，訂單已取消，沒有扣 EC",
  canceled_2fa: "交易報價沒有通過 Steam 驗證，訂單已取消，沒有扣 EC"
};

const TRADE_URL = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/?\?/;

export function orderCharge(order) {
  const total = Number(order.total) || 0;
  return order.type === "trade" ? Math.max(0, total - (Number(order.offerTotal) || 0)) : total;
}

export function shortId(id) {
  return String(id).slice(-6).toUpperCase();
}

export function typeLabel(type) {
  return type === "trade" ? "交易" : "購買";
}

// 交易連結 → 對方的 SteamID64
export function partnerSteamId(tradeUrl) {
  try {
    const url = new URL(String(tradeUrl || ""));
    const partner = url.searchParams.get("partner");
    if (!TRADE_URL.test(String(tradeUrl)) || !/^\d{1,10}$/.test(partner || "") || !url.searchParams.get("token")) return "";
    return (76561197960265728n + BigInt(partner)).toString();
  } catch {
    return "";
  }
}

// 有磨損值、貼紙、吊飾、命名牌的是獨一無二的物品，只能送上架時那一件
export function isUniqueListing(listing) {
  const details = listing?.steam?.details || {};
  return Number.isFinite(details.f) || Boolean(details.s?.length) || Boolean(details.k?.length) || Boolean(details.t);
}

function quantities(order) {
  const totals = new Map();
  for (const item of order.items || []) {
    if (!item.listingId) continue;
    totals.set(item.listingId, (totals.get(item.listingId) || 0) + (Number(item.quantity) || 1));
  }
  return totals;
}

// 檢查訂單能不能交給機器人。回傳 null 代表沒問題，不然回傳 { cancel, message }
export function checkOrder(order, listings, { strictPrice }) {
  if (!partnerSteamId(order.tradeUrl)) {
    return { cancel: true, message: "Steam 交易連結格式不正確，請到「設定」重新貼上交易連結後再下單" };
  }
  for (const item of order.items || []) {
    const listing = item.listingId ? listings.get(item.listingId) : null;
    if (!listing) return { cancel: false, message: `找不到商品「${item.name}」，需要管理員手動處理` };
    if (listing.source !== "steam" || !Array.isArray(listing.steam?.assetIds) || !listing.steam.assetIds.length) {
      return { cancel: false, message: `「${item.name}」不是從 Steam 庫存上架的商品，需要管理員手動出貨` };
    }
  }
  if (strictPrice) {
    for (const item of order.items || []) {
      const listing = listings.get(item.listingId);
      if (listing.listed === false || Number(listing.price) !== Number(item.price)) {
        return { cancel: false, message: `「${item.name}」的價格或上架狀態變了，需要管理員確認` };
      }
    }
    for (const [listingId, quantity] of quantities(order)) {
      if ((Number(listings.get(listingId).stock) || 0) < quantity) {
        return { cancel: false, message: `「${listings.get(listingId).name || "商品"}」庫存不夠，需要管理員確認` };
      }
    }
  }
  if (order.type === "trade") {
    for (const item of order.offerItems || []) {
      if (!/^\d+$/.test(String(item.assetId || ""))) {
        return { cancel: false, message: `買家提供的「${item.name}」沒有 Steam 物品資料，需要手動處理` };
      }
    }
  }
  return null;
}

// 從機器人庫存挑出要送的物品。inventory：[{ assetid, marketHashName }]
export function pickAssets(order, listings, inventory, reserved = new Set()) {
  const available = new Map(inventory.map((item) => [String(item.assetid), item]));
  const used = new Set(reserved);
  const give = [];
  const missing = [];
  for (const [listingId, quantity] of quantities(order)) {
    const listing = listings.get(listingId);
    const picked = [];
    for (const assetId of listing.steam.assetIds.map(String)) {
      if (picked.length >= quantity) break;
      if (available.has(assetId) && !used.has(assetId)) picked.push(assetId);
      used.add(assetId);
    }
    // 武器箱這類一模一樣的物品，上架時那幾件被換掉也沒關係，用同名的補
    if (picked.length < quantity && !isUniqueListing(listing) && listing.steam.marketHashName) {
      for (const item of inventory) {
        if (picked.length >= quantity) break;
        const assetId = String(item.assetid);
        if (item.marketHashName === listing.steam.marketHashName && !used.has(assetId)) {
          picked.push(assetId);
          used.add(assetId);
        }
      }
    }
    if (picked.length < quantity) missing.push(listing.name || listing.steam.marketHashName || listingId);
    give.push(...picked);
  }
  return { give, missing };
}

export function createBot({ db, steam, FieldValue, config = {}, now = () => Date.now(), log = () => {} }) {
  const open = new Map(); // 目前未完成的訂單（id → 資料）
  let chain = Promise.resolve();
  const queued = new Set();
  let reconciled = false;
  let stopWatch = null;

  const orders = () => db.collection("orders");
  const autoPurchase = config.autoPurchase !== false;

  function notify(to, title, body, orderId) {
    return db.collection("notifications").add({
      to,
      from: "bot",
      title: String(title).slice(0, 100),
      body: String(body).slice(0, 300),
      link: to === "admin" ? "#admin" : "#orders",
      orderId: orderId || "",
      read: false,
      createdAt: now()
    }).catch((error) => log("通知寫入失敗：", error.message));
  }

  function requestInventoryRefresh(docId, steamId) {
    if (!/^\d{17}$/.test(String(steamId || ""))) return Promise.resolve();
    return db.collection("inventoryRequests").doc(docId)
      .set({ steamId: String(steamId), status: "pending", message: "", requestedAt: now() }, { merge: true })
      .catch((error) => log("要求重新讀庫存失敗：", error.message));
  }

  function eligible(order) {
    if (order.bot) return false;
    if (order.status === "pending" && order.type === "purchase" && autoPurchase) return true;
    return order.status === "processing" && order.botRequested === true;
  }

  // 其他進行中的報價已經佔用的物品和 EC
  function reservations(exceptId) {
    const assets = new Set();
    let charge = 0;
    for (const [id, order] of open) {
      if (id === exceptId || !ACTIVE_STATES.includes(order.bot?.state)) continue;
      (order.bot.give || []).forEach((assetId) => assets.add(String(assetId)));
      charge += orderCharge(order);
    }
    return { assets, charge };
  }

  async function readListings(tx, order) {
    const listings = new Map();
    for (const listingId of quantities(order).keys()) {
      const snapshot = await tx.get(db.collection("listings").doc(listingId));
      if (snapshot.exists) listings.set(listingId, snapshot.data());
    }
    return listings;
  }

  async function markManual(id, order, message) {
    await orders().doc(id).update({ bot: { state: "manual", message, updatedAt: now() } });
    await notify("admin", "訂單需要手動處理", `${typeLabel(order.type)}訂單 #${shortId(id)}：${message}`, id);
    log(`訂單 ${shortId(id)} 需要手動處理：${message}`);
  }

  async function cancelOrder(id, order, state, message, { notifyAdmin = false } = {}) {
    const time = now();
    await orders().doc(id).update({ status: "cancelled", bot: { state, message, updatedAt: time }, updatedAt: time });
    await notify(order.uid, "訂單已取消", `你的${typeLabel(order.type)}訂單 #${shortId(id)}：${message}`, id);
    if (notifyAdmin) await notify("admin", "機器人取消了訂單", `${typeLabel(order.type)}訂單 #${shortId(id)}：${message}`, id);
    log(`訂單 ${shortId(id)} 取消：${message}`);
  }

  // ---------- 接單、送報價 ----------

  async function processOrder(id) {
    const reference = orders().doc(id);
    const claim = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(reference);
      if (!snapshot.exists) return null;
      const order = { id, ...snapshot.data() };
      if (!eligible(order)) return null;
      const listings = await readListings(tx, order);
      const wallet = await tx.get(db.collection("wallets").doc(order.uid));
      const balance = wallet.exists ? Number(wallet.data().balance) || 0 : 0;
      const problem = checkOrder(order, listings, { strictPrice: order.status === "pending" });
      const time = now();
      if (problem) return { order, problem };
      const charge = orderCharge(order);
      const available = balance - reservations(id).charge;
      if (available < charge) {
        return { order, problem: { cancel: order.status === "pending", message: `EC 不夠喔，需要 ${charge.toLocaleString()} EC，可用 ${Math.max(0, available).toLocaleString()} EC` } };
      }
      tx.update(reference, { status: "processing", botRequested: true, bot: { state: "sending", message: "", updatedAt: time }, updatedAt: time });
      return { order, listings };
    });
    if (!claim) return;
    const { order } = claim;
    if (claim.problem) {
      if (claim.problem.cancel) await cancelOrder(id, order, "failed", claim.problem.message);
      else await markManual(id, order, claim.problem.message);
      return;
    }
    open.set(id, { ...order, status: "processing", bot: { state: "sending" } });

    let give;
    try {
      const inventory = await steam.getInventory();
      const picked = pickAssets(order, claim.listings, inventory, reservations(id).assets);
      if (picked.missing.length) {
        await markManual(id, order, `機器人庫存裡找不到：${picked.missing.join("、")}（可能已經送出去，或還沒放進機器人帳號）`);
        return;
      }
      give = picked.give;
    } catch (error) {
      await markManual(id, order, `讀不到機器人的 Steam 庫存：${error.message}`);
      return;
    }
    const receive = order.type === "trade" ? (order.offerItems || []).map((item) => String(item.assetId)) : [];

    let result;
    try {
      result = await steam.sendOffer({ tradeUrl: order.tradeUrl, give, receive, message: `ELOSKIN2 ${typeLabel(order.type)}訂單 #${shortId(id)}` });
    } catch (error) {
      if (error.userFault) await cancelOrder(id, order, "failed", error.message);
      else await markManual(id, order, `送出交易報價失敗：${error.message}`);
      return;
    }

    const time = now();
    const bot = { state: result.state, offerId: String(result.offerId), give, receive, message: result.message || "", sentAt: time, updatedAt: time };
    await reference.update({ bot });
    open.set(id, { ...order, status: "processing", bot });
    log(`訂單 ${shortId(id)} 已送出報價 ${result.offerId}（${result.state}）`);
    await notify(order.uid, "交易報價已送出", `你的${typeLabel(order.type)}訂單 #${shortId(id)}：機器人已經送出 Steam 交易報價，請到 Steam 接受`, id);

    // 送出途中管理員剛好取消了訂單，就把報價收回
    const fresh = await reference.get();
    if (fresh.exists && fresh.data().status === "cancelled") await withdraw(id, fresh.data());
  }

  function enqueue(id) {
    if (queued.has(id)) return;
    queued.add(id);
    chain = chain.then(async () => {
      queued.delete(id);
      if (!steam.ready()) return;
      try {
        await processOrder(id);
      } catch (error) {
        log(`處理訂單 ${shortId(id)} 時出錯：`, error.message);
      }
    });
  }

  // ---------- 報價狀態改變 ----------

  async function complete(id, offerId) {
    const reference = orders().doc(id);
    const done = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(reference);
      if (!snapshot.exists) return null;
      const order = { id, ...snapshot.data() };
      if (order.bot?.offerId !== String(offerId) || order.bot?.state === "accepted" || order.status === "completed") return null;
      const totals = quantities(order);
      const listingRefs = [...totals.keys()].map((listingId) => db.collection("listings").doc(listingId));
      const listingSnapshots = [];
      for (const listingRef of listingRefs) listingSnapshots.push(await tx.get(listingRef));
      const walletRef = db.collection("wallets").doc(order.uid);
      const wallet = await tx.get(walletRef);
      const balance = wallet.exists ? Number(wallet.data().balance) || 0 : 0;
      const charge = orderCharge(order);
      const time = now();
      const give = (order.bot.give || []).map(String);
      listingSnapshots.forEach((listingSnapshot, index) => {
        if (!listingSnapshot.exists) return;
        const stock = Number(listingSnapshot.data().stock) || 0;
        const update = { stock: Math.max(0, stock - totals.get(listingRefs[index].id)), updatedAt: time };
        if (give.length) update["steam.assetIds"] = FieldValue.arrayRemove(...give);
        tx.update(listingRefs[index], update);
      });
      if (charge > 0) {
        tx.set(walletRef, { balance: balance - charge, updatedAt: time }, { merge: true });
        tx.set(db.collection("walletTransactions").doc(), {
          uid: order.uid,
          amount: -charge,
          balanceAfter: balance - charge,
          type: order.type,
          refId: id,
          note: `${typeLabel(order.type)}訂單 #${shortId(id)}`,
          createdAt: time
        });
      }
      tx.update(reference, { status: "completed", bot: { ...order.bot, state: "accepted", message: "", updatedAt: time }, updatedAt: time });
      return { order, short: balance < charge };
    });
    if (!done) return;
    const { order } = done;
    open.delete(id);
    log(`訂單 ${shortId(id)} 完成`);
    await notify(order.uid, "訂單已完成", `你的${typeLabel(order.type)}訂單 #${shortId(id)} 已經在 Steam 交易完成`, id);
    if (done.short) await notify("admin", "買家 EC 變成負的", `${typeLabel(order.type)}訂單 #${shortId(id)} 交易完成時買家 EC 不夠，餘額已經變成負的`, id);
    await requestInventoryRefresh("admin", steam.steamId());
    await requestInventoryRefresh(order.uid, partnerSteamId(order.tradeUrl));
  }

  async function fail(id, offerId, state) {
    const reference = orders().doc(id);
    const message = FAIL_MESSAGES[state] || FAIL_MESSAGES.canceled;
    const result = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(reference);
      if (!snapshot.exists) return null;
      const order = { id, ...snapshot.data() };
      if (order.bot?.offerId !== String(offerId) || !ACTIVE_STATES.includes(order.bot?.state)) return null;
      const time = now();
      const update = { bot: { ...order.bot, state, message, updatedAt: time } };
      if (order.status === "processing") Object.assign(update, { status: "cancelled", updatedAt: time });
      tx.update(reference, update);
      return order;
    });
    if (!result) return;
    open.delete(id);
    log(`訂單 ${shortId(id)} 報價 ${state}`);
    if (result.status === "processing") await notify(result.uid, "訂單已取消", `你的${typeLabel(result.type)}訂單 #${shortId(id)}：${message}`, id);
  }

  async function onOfferChanged(offerId, state) {
    const snapshot = await orders().where("bot.offerId", "==", String(offerId)).limit(1).get();
    if (snapshot.empty) return;
    const doc = snapshot.docs[0];
    const order = doc.data();
    if (state === "accepted") return complete(doc.id, offerId);
    if (FAIL_MESSAGES[state]) return fail(doc.id, offerId, state);
    if (["sent", "confirming", "escrow"].includes(state) && order.bot?.state !== state && ACTIVE_STATES.includes(order.bot?.state)) {
      const message = state === "escrow" ? "Steam 暫留這筆交易，暫留結束後物品會自動送到" : "";
      await doc.ref.update({ "bot.state": state, "bot.message": message, "bot.updatedAt": now() });
      if (state === "escrow") await notify(order.uid, "交易被 Steam 暫留", `你的${typeLabel(order.type)}訂單 #${shortId(doc.id)}：${message}`, doc.id);
    }
  }

  // 管理員取消了已經送出報價的訂單 → 收回報價
  async function withdraw(id, order) {
    if (!order?.bot?.offerId || !ACTIVE_STATES.includes(order.bot.state)) return;
    try {
      await steam.cancelOffer(order.bot.offerId);
    } catch (error) {
      log(`收回報價 ${order.bot.offerId} 失敗：`, error.message);
    }
    await orders().doc(id).update({ "bot.state": "canceled", "bot.message": "管理員取消了訂單，交易報價已經收回", "bot.updatedAt": now() });
    open.delete(id);
    log(`訂單 ${shortId(id)} 被取消，已收回報價`);
  }

  async function onClosed(id) {
    const snapshot = await orders().doc(id).get();
    if (!snapshot.exists) return;
    const order = snapshot.data();
    if (order.status === "cancelled") await withdraw(id, order);
  }

  // ---------- 啟動、監聽 ----------

  // 機器人離線期間報價可能已經被接受／拒絕，上線時對一次
  async function reconcile() {
    const snapshot = await orders().where("bot.state", "in", ACTIVE_STATES).get();
    for (const doc of snapshot.docs) {
      const order = doc.data();
      try {
        if (order.bot.state === "sending" || !order.bot.offerId) {
          await markManual(doc.id, order, "機器人送出報價時中斷了，請到機器人的 Steam 確認有沒有送出，再決定重送或手動處理");
          continue;
        }
        const state = await steam.getOfferState(order.bot.offerId);
        if (order.status === "cancelled" && ["sent", "confirming", "escrow"].includes(state)) await withdraw(doc.id, order);
        else await onOfferChanged(order.bot.offerId, state);
      } catch (error) {
        log(`核對訂單 ${shortId(doc.id)} 失敗：`, error.message);
      }
    }
  }

  function scan() {
    for (const [id, order] of open) if (eligible(order)) enqueue(id);
  }

  async function onSteamReady() {
    if (!reconciled) {
      reconciled = true;
      chain = chain.then(() => reconcile().catch((error) => log("核對報價失敗：", error.message)));
    }
    scan();
    return chain;
  }

  function watch() {
    stopWatch = orders().where("status", "in", ["pending", "processing"]).onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const id = change.doc.id;
        if (change.type === "removed") {
          open.delete(id);
          chain = chain.then(() => onClosed(id).catch((error) => log(`處理取消 ${shortId(id)} 失敗：`, error.message)));
          return;
        }
        const order = { id, ...change.doc.data() };
        open.set(id, order);
        if (eligible(order) && steam.ready() && reconciled) enqueue(id);
      });
    }, (error) => {
      log("監聽訂單失敗：", error.message);
      config.onWatchError?.(error);
    });
    return stopWatch;
  }

  // 別人送給機器人的報價：管理員帳號送來補貨（機器人不用給東西）就收，其他一律拒絕
  function decideIncoming({ partner, giving, receiving }) {
    const owners = (config.ownerSteamIds || []).map(String);
    if (owners.includes(String(partner)) && giving === 0 && receiving > 0) return "accept";
    return config.declineUnknownOffers === false ? "ignore" : "decline";
  }

  function stats() {
    return { active: [...open.values()].filter((order) => ACTIVE_STATES.includes(order.bot?.state)).length, open: open.size };
  }

  return { watch, onSteamReady, onOfferChanged, decideIncoming, requestInventoryRefresh, stats, idle: () => chain, _open: open };
}

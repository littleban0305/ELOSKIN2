// 交易機器人訂單邏輯的測試：node --test bot-core.test.mjs（不用連 Steam 或 Firebase）
import test from "node:test";
import assert from "node:assert/strict";
import { createBot, partnerSteamId, pickAssets } from "./bot-core.mjs";

// ---------- 假的 Firestore（只做機器人用到的部分） ----------

const FieldValue = { arrayRemove: (...values) => ({ __remove: values }) };

function getPath(data, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data);
}

function applyUpdate(data, update) {
  const next = structuredClone(data);
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split(".");
    let target = next;
    keys.slice(0, -1).forEach((key) => { target[key] = target[key] && typeof target[key] === "object" ? target[key] : {}; target = target[key]; });
    const last = keys[keys.length - 1];
    target[last] = value?.__remove ? (target[last] || []).filter((item) => !value.__remove.includes(item)) : value;
  }
  return next;
}

function fakeDb() {
  const store = new Map();
  const watchers = [];
  let autoId = 0;
  const key = (collection, id) => `${collection}/${id}`;

  function snapshotOf(collection, id) {
    const data = store.get(key(collection, id));
    return { id, exists: data !== undefined, data: () => structuredClone(data), ref: docRef(collection, id) };
  }

  function emit() {
    for (const watcher of watchers) watcher.refresh();
  }

  function write(collection, id, data) {
    if (data === undefined) store.delete(key(collection, id));
    else store.set(key(collection, id), data);
    emit();
  }

  function docRef(collection, id) {
    return {
      id,
      async get() { return snapshotOf(collection, id); },
      async set(data, options) {
        const current = store.get(key(collection, id));
        write(collection, id, options?.merge && current ? applyUpdate(current, data) : structuredClone(data));
      },
      async update(data) {
        const current = store.get(key(collection, id));
        if (!current) throw new Error(`no document ${collection}/${id}`);
        write(collection, id, applyUpdate(current, data));
      }
    };
  }

  function query(collection, filters = [], max = Infinity) {
    const matches = () => [...store.keys()]
      .filter((path) => path.startsWith(`${collection}/`))
      .map((path) => path.slice(collection.length + 1))
      .filter((id) => filters.every(([field, op, value]) => {
        const actual = getPath(store.get(key(collection, id)), field);
        return op === "in" ? value.includes(actual) : actual === value;
      }))
      .slice(0, max);
    return {
      where: (field, op, value) => query(collection, [...filters, [field, op, value]], max),
      limit: (count) => query(collection, filters, count),
      async get() {
        const docs = matches().map((id) => snapshotOf(collection, id));
        return { empty: docs.length === 0, docs };
      },
      onSnapshot(callback) {
        let previous = new Map();
        const watcher = {
          refresh() {
            const current = new Map(matches().map((id) => [id, JSON.stringify(store.get(key(collection, id)))]));
            const changes = [];
            for (const [id, json] of current) {
              if (!previous.has(id)) changes.push({ type: "added", doc: snapshotOf(collection, id) });
              else if (previous.get(id) !== json) changes.push({ type: "modified", doc: snapshotOf(collection, id) });
            }
            for (const id of previous.keys()) if (!current.has(id)) changes.push({ type: "removed", doc: snapshotOf(collection, id) });
            previous = current;
            if (changes.length) callback({ docChanges: () => changes });
          }
        };
        watchers.push(watcher);
        watcher.refresh();
        return () => watchers.splice(watchers.indexOf(watcher), 1);
      }
    };
  }

  const db = {
    collection(name) {
      return {
        doc: (id) => docRef(name, id ?? `auto${++autoId}`),
        async add(data) { const id = `auto${++autoId}`; write(name, id, structuredClone(data)); return docRef(name, id); },
        where: (field, op, value) => query(name, [[field, op, value]])
      };
    },
    async runTransaction(work) {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        update: (ref, data) => writes.push(() => ref.update(data)),
        set: (ref, data, options) => writes.push(() => ref.set(data, options))
      };
      const result = await work(tx);
      for (const apply of writes) await apply();
      return result;
    }
  };
  return { db, store, get: (collection, id) => store.get(key(collection, id)), put: (collection, id, data) => write(collection, id, structuredClone(data)) };
}

// ---------- 假的 Steam ----------

function fakeSteam(inventory) {
  const sent = [];
  const canceled = [];
  const states = new Map();
  return {
    sent,
    canceled,
    states,
    failNext: null,
    ready: () => true,
    steamId: () => "76561198000000001",
    async getInventory() { return inventory; },
    async sendOffer(offer) {
      if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
      const offerId = String(9000 + sent.length);
      sent.push({ ...offer, offerId });
      states.set(offerId, "sent");
      return { offerId, state: "sent" };
    },
    async cancelOffer(offerId) { canceled.push(String(offerId)); states.set(String(offerId), "canceled"); },
    async getOfferState(offerId) { return states.get(String(offerId)) || "sent"; }
  };
}

const TRADE_URL = "https://steamcommunity.com/tradeoffer/new/?partner=123456&token=AbC-12";

function setup({ inventory = [{ assetid: "111", marketHashName: "AK-47 | Redline (Field-Tested)" }, { assetid: "222", marketHashName: "Kilowatt Case" }, { assetid: "223", marketHashName: "Kilowatt Case" }], balance = 1000, config = {} } = {}) {
  const fake = fakeDb();
  fake.put("listings", "ak", { name: "AK 紅線", price: 500, stock: 1, listed: true, source: "steam", steam: { marketHashName: "AK-47 | Redline (Field-Tested)", assetIds: ["111"], details: { f: 0.2 } } });
  fake.put("listings", "case", { name: "千瓦武器箱", price: 50, stock: 5, listed: true, source: "steam", steam: { marketHashName: "Kilowatt Case", assetIds: ["220", "222"], details: {} } });
  fake.put("listings", "custom", { name: "自訂商品", price: 10, stock: 3, listed: true, source: "custom", steam: null });
  fake.put("wallets", "u1", { balance });
  const steam = fakeSteam(inventory);
  const logs = [];
  const bot = createBot({ db: fake.db, steam, FieldValue, config, now: () => 1000, log: (...args) => logs.push(args.join(" ")) });
  return { fake, steam, bot, logs };
}

function purchase(items, extra = {}) {
  return { type: "purchase", uid: "u1", buyerName: "弟弟", tradeUrl: TRADE_URL, items, offerItems: [], total: items.reduce((sum, item) => sum + item.price * item.quantity, 0), offerTotal: 0, note: "", adminNote: "", status: "pending", createdAt: 1, updatedAt: 1, ...extra };
}

async function start(context) {
  context.bot.watch();
  await context.bot.onSteamReady();
  await context.bot.idle();
}

// ---------- 測試 ----------

test("交易連結換算 SteamID64", () => {
  assert.equal(partnerSteamId(TRADE_URL), "76561197960389184");
  assert.equal(partnerSteamId("https://evil.example/tradeoffer/new/?partner=1&token=a"), "");
  assert.equal(partnerSteamId("https://steamcommunity.com/tradeoffer/new/?partner=1"), "");
});

test("同名物品可以用別件補，獨一無二的不行", () => {
  const listings = new Map([["case", { steam: { marketHashName: "Kilowatt Case", assetIds: ["220"], details: {} } }]]);
  const order = { items: [{ listingId: "case", quantity: 2 }] };
  const picked = pickAssets(order, listings, [{ assetid: "222", marketHashName: "Kilowatt Case" }, { assetid: "223", marketHashName: "Kilowatt Case" }]);
  assert.deepEqual(picked, { give: ["222", "223"], missing: [] });
  const unique = new Map([["ak", { name: "AK", steam: { marketHashName: "AK", assetIds: ["111"], details: { f: 0.1 } } }]]);
  assert.deepEqual(pickAssets({ items: [{ listingId: "ak", quantity: 1 }] }, unique, [{ assetid: "999", marketHashName: "AK" }]).missing, ["AK"]);
});

test("購買訂單自動送出報價，接受後完成、扣 EC、扣庫存", async () => {
  const context = setup();
  context.fake.put("orders", "order1", purchase([{ listingId: "ak", name: "AK 紅線", price: 500, quantity: 1 }, { listingId: "case", name: "千瓦武器箱", price: 50, quantity: 2 }]));
  await start(context);
  assert.equal(context.steam.sent.length, 1);
  assert.deepEqual(context.steam.sent[0].give, ["111", "222", "223"]);
  assert.deepEqual(context.steam.sent[0].receive, []);
  let order = context.fake.get("orders", "order1");
  assert.equal(order.status, "processing");
  assert.equal(order.bot.state, "sent");

  await context.bot.onOfferChanged(order.bot.offerId, "accepted");
  await context.bot.idle();
  order = context.fake.get("orders", "order1");
  assert.equal(order.status, "completed");
  assert.equal(order.bot.state, "accepted");
  assert.equal(context.fake.get("wallets", "u1").balance, 400);
  assert.equal(context.fake.get("listings", "ak").stock, 0);
  assert.equal(context.fake.get("listings", "case").stock, 3);
  assert.deepEqual(context.fake.get("listings", "case").steam.assetIds, ["220"]);
  assert.equal(context.fake.get("inventoryRequests", "admin").status, "pending");
  assert.equal(context.fake.get("inventoryRequests", "u1").steamId, "76561197960389184");
  const ledger = [...context.fake.store.entries()].filter(([path]) => path.startsWith("walletTransactions/"));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0][1].amount, -600);

  // 重複收到「接受」不會再扣一次
  await context.bot.onOfferChanged(order.bot.offerId, "accepted");
  assert.equal(context.fake.get("wallets", "u1").balance, 400);
});

test("拒絕報價 → 訂單取消、不扣 EC", async () => {
  const context = setup();
  context.fake.put("orders", "order2", purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]));
  await start(context);
  const offerId = context.fake.get("orders", "order2").bot.offerId;
  await context.bot.onOfferChanged(offerId, "declined");
  await context.bot.idle();
  const order = context.fake.get("orders", "order2");
  assert.equal(order.status, "cancelled");
  assert.equal(order.bot.state, "declined");
  assert.equal(context.fake.get("wallets", "u1").balance, 1000);
});

test("自訂商品、價格變了 → 交給管理員；EC 不夠 → 取消", async () => {
  const context = setup({ balance: 20 });
  context.fake.put("orders", "custom", purchase([{ listingId: "custom", name: "自訂商品", price: 10, quantity: 1 }]));
  context.fake.put("orders", "price", purchase([{ listingId: "case", name: "千瓦武器箱", price: 1, quantity: 1 }]));
  context.fake.put("orders", "poor", purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]));
  await start(context);
  assert.equal(context.steam.sent.length, 0);
  assert.equal(context.fake.get("orders", "custom").bot.state, "manual");
  assert.equal(context.fake.get("orders", "custom").status, "pending");
  assert.equal(context.fake.get("orders", "price").bot.state, "manual");
  assert.equal(context.fake.get("orders", "poor").status, "cancelled");
  assert.match(context.fake.get("orders", "poor").bot.message, /EC 不夠/);
});

test("交易訂單要等管理員交給機器人，會跟買家要物品", async () => {
  const context = setup();
  const trade = { ...purchase([{ listingId: "ak", name: "AK 紅線", price: 500, quantity: 1 }]), type: "trade", offerItems: [{ name: "M4", value: 300, assetId: "555" }], offerTotal: 300 };
  context.fake.put("orders", "trade1", trade);
  await start(context);
  assert.equal(context.steam.sent.length, 0);
  await context.fake.db.collection("orders").doc("trade1").update({ status: "processing", botRequested: true });
  await context.bot.idle();
  assert.equal(context.steam.sent.length, 1);
  assert.deepEqual(context.steam.sent[0].receive, ["555"]);
  await context.bot.onOfferChanged(context.fake.get("orders", "trade1").bot.offerId, "accepted");
  assert.equal(context.fake.get("wallets", "u1").balance, 800);
});

test("兩筆訂單不會搶同一件物品", async () => {
  const context = setup();
  context.fake.put("orders", "a", purchase([{ listingId: "ak", name: "AK 紅線", price: 500, quantity: 1 }]));
  context.fake.put("orders", "b", purchase([{ listingId: "ak", name: "AK 紅線", price: 500, quantity: 1 }], { createdAt: 2 }));
  // 第二筆庫存檢查會擋（stock 1），改成兩件庫存看物品保留
  await context.fake.db.collection("listings").doc("ak").update({ stock: 2 });
  await start(context);
  assert.equal(context.steam.sent.length, 1);
  const states = ["a", "b"].map((id) => context.fake.get("orders", id).bot.state).sort();
  assert.deepEqual(states, ["manual", "sent"]);
});

test("管理員取消已送出的訂單 → 收回報價", async () => {
  const context = setup();
  context.fake.put("orders", "c1", purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]));
  await start(context);
  const offerId = context.fake.get("orders", "c1").bot.offerId;
  await context.fake.db.collection("orders").doc("c1").update({ status: "cancelled" });
  await context.bot.idle();
  assert.deepEqual(context.steam.canceled, [offerId]);
  assert.equal(context.fake.get("orders", "c1").bot.state, "canceled");
  // 之後 Steam 回報「已取消」也不會重複通知
  await context.bot.onOfferChanged(offerId, "canceled");
  assert.equal(context.fake.get("orders", "c1").bot.state, "canceled");
});

test("買家交易會被暫留 → 取消並說明；Steam 出錯 → 交給管理員", async () => {
  const context = setup();
  context.steam.failNext = Object.assign(new Error("你的 Steam 交易會被暫留 15 天"), { userFault: true });
  context.fake.put("orders", "e1", purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]));
  await start(context);
  assert.equal(context.fake.get("orders", "e1").status, "cancelled");
  context.steam.failNext = new Error("Steam 暫時連不上");
  context.fake.put("orders", "e2", purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]));
  await context.bot.idle();
  assert.equal(context.fake.get("orders", "e2").bot.state, "manual");
  assert.equal(context.fake.get("orders", "e2").status, "processing");
});

test("機器人重開時核對離線期間的報價", async () => {
  const context = setup();
  context.fake.put("orders", "r1", { ...purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]), status: "processing", botRequested: true, bot: { state: "sent", offerId: "777", give: ["222"], receive: [] } });
  context.fake.put("orders", "r2", { ...purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]), status: "processing", botRequested: true, bot: { state: "sending" } });
  context.steam.states.set("777", "accepted");
  await start(context);
  assert.equal(context.fake.get("orders", "r1").status, "completed");
  assert.equal(context.fake.get("orders", "r2").bot.state, "manual");
});

test("補貨報價：管理員送來的收下，其他拒絕", () => {
  const { bot } = setup({ config: { ownerSteamIds: ["76561198000000099"] } });
  assert.equal(bot.decideIncoming({ partner: "76561198000000099", giving: 0, receiving: 3 }), "accept");
  assert.equal(bot.decideIncoming({ partner: "76561198000000099", giving: 1, receiving: 3 }), "decline");
  assert.equal(bot.decideIncoming({ partner: "76561198000000555", giving: 0, receiving: 1 }), "decline");
});

test("禮品券訂單：自動送出、不扣 EC；被拒絕會把券還回去", async () => {
  const context = setup();
  context.fake.put("coupons", "GIFT-AK", { code: "GIFT-AK", type: "gift", listingId: "case" });
  context.fake.put("userCoupons", "u1_GIFT-AK", { uid: "u1", code: "GIFT-AK", type: "gift", used: true, orderId: "g1" });
  context.fake.put("orders", "g1", { ...purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }]), type: "gift", total: 0, couponCode: "GIFT-AK" });
  context.fake.put("userCoupons", "u1_GIFT-B", { uid: "u1", code: "GIFT-B", type: "gift", used: true, orderId: "g2" });
  context.fake.put("coupons", "GIFT-B", { code: "GIFT-B", type: "gift", listingId: "case" });
  context.fake.put("orders", "g2", { ...purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }], { createdAt: 2 }), type: "gift", total: 0, couponCode: "GIFT-B" });
  await start(context);
  assert.equal(context.steam.sent.length, 2);
  await context.bot.onOfferChanged(context.fake.get("orders", "g1").bot.offerId, "accepted");
  assert.equal(context.fake.get("orders", "g1").status, "completed");
  assert.equal(context.fake.get("wallets", "u1").balance, 1000);
  assert.equal(context.fake.get("listings", "case").stock, 4);
  await context.bot.onOfferChanged(context.fake.get("orders", "g2").bot.offerId, "declined");
  assert.equal(context.fake.get("orders", "g2").status, "cancelled");
  assert.deepEqual([context.fake.get("userCoupons", "u1_GIFT-B").used, context.fake.get("userCoupons", "u1_GIFT-B").orderId], [false, ""]);
  assert.equal(context.fake.get("userCoupons", "u1_GIFT-AK").used, true);
});

test("折價券：折扣算對就送出，算錯交給管理員", async () => {
  const context = setup();
  context.fake.put("coupons", "OFF10", { code: "OFF10", type: "discount", percent: 10, amount: 0, maxDiscount: 30, minSubtotal: 0 });
  context.fake.put("userCoupons", "u1_OFF10", { uid: "u1", code: "OFF10", type: "discount", used: true, orderId: "d1" });
  // 小計 100，打九折 = 10，最多折 30 → 折 10
  context.fake.put("orders", "d1", { ...purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 2 }]), subtotal: 100, discount: 10, total: 90, couponCode: "OFF10" });
  context.fake.put("coupons", "BIG", { code: "BIG", type: "discount", percent: 0, amount: 20, maxDiscount: 0, minSubtotal: 0 });
  context.fake.put("userCoupons", "u1_BIG", { uid: "u1", code: "BIG", type: "discount", used: true, orderId: "d2" });
  context.fake.put("orders", "d2", { ...purchase([{ listingId: "case", name: "千瓦武器箱", price: 50, quantity: 1 }], { createdAt: 2 }), subtotal: 50, discount: 49, total: 1, couponCode: "BIG" });
  await start(context);
  assert.equal(context.fake.get("orders", "d1").bot.state, "sent");
  assert.equal(context.fake.get("orders", "d2").bot.state, "manual");
  await context.bot.onOfferChanged(context.fake.get("orders", "d1").bot.offerId, "accepted");
  assert.equal(context.fake.get("wallets", "u1").balance, 910);
});

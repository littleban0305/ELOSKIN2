// 折價券、禮品券
//   coupons/{代碼}：管理員在管理頁「禮券」建立（圖片、連結、折扣或禮品）
//   userCoupons/{uid}_{代碼}：使用者在「兌換禮券」頁領到的券
// 折價券：結帳前在購物車選擇，折抵 EC；禮品券：兌換時直接建立一筆免費的禮品訂單
(() => {
  const text = window.eloText;
  const $ = (selector) => document.querySelector(selector);
  const CODE_PATTERN = /^[A-Z0-9-]{4,24}$/;

  let currentUser = null;
  let isAdmin = false;
  let adminVerified = false;
  let listeners = [];
  let myCoupons = []; // userCoupons
  const couponCache = new Map(); // 代碼 → coupons 文件（null = 找不到）
  let previewCoupon = null;
  let adminCoupons = [];
  let adminListings = [];
  let adminStarted = false;
  let cartSelection = "";
  const confirmTimers = new WeakMap();

  const db = () => window.eloFirebaseDb || null;
  const toast = (message) => window.eloApp?.showToast(message);

  // ---------- 共用 ----------

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function shortId(id) {
    return String(id).slice(-6).toUpperCase();
  }

  function formatDate(ms) {
    return new Date(Number(ms)).toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" });
  }

  function safeImage(url) {
    return /^https:\/\//.test(String(url || "")) ? String(url) : "";
  }

  // 能折多少（機器人 relay/bot-core.mjs 用一樣的算法檢查）
  function discountFor(coupon, subtotal) {
    if (!coupon || coupon.type !== "discount" || subtotal < (Number(coupon.minSubtotal) || 0)) return 0;
    const percent = Number(coupon.percent) || 0;
    let discount = percent > 0 ? Math.floor(subtotal * percent / 100) : Number(coupon.amount) || 0;
    if (percent > 0 && Number(coupon.maxDiscount) > 0) discount = Math.min(discount, Number(coupon.maxDiscount));
    return Math.max(0, Math.min(discount, subtotal));
  }

  function isExpired(coupon) {
    return Number(coupon?.expiresAt) > 0 && Date.now() >= Number(coupon.expiresAt);
  }

  // 「85 折」「9 折」
  function zheText(percent) {
    const zhe = 100 - percent;
    return zhe % 10 === 0 ? String(zhe / 10) : String(zhe);
  }

  function summaryParts(coupon) {
    const parts = [];
    if (coupon.type === "gift") {
      parts.push(text("coupons.giftOf", { name: coupon.listingName || "" }));
    } else {
      if (Number(coupon.percent) > 0) {
        parts.push(text("coupons.percentOff", { zhe: zheText(Number(coupon.percent)) }));
        if (Number(coupon.maxDiscount) > 0) parts.push(text("coupons.percentCap", { cap: Number(coupon.maxDiscount).toLocaleString() }));
      } else {
        parts.push(text("coupons.amountOff", { amount: Number(coupon.amount || 0).toLocaleString() }));
      }
      if (Number(coupon.minSubtotal) > 0) parts.push(text("coupons.minSubtotal", { min: Number(coupon.minSubtotal).toLocaleString() }));
    }
    return parts;
  }

  // 一張券的卡片（兌換預覽、我的禮券、管理頁共用）
  function couponCard(coupon, { code, extra = [] } = {}) {
    const card = element("article", `coupon-card coupon-${coupon?.type || "discount"}`);
    const art = element("div", "coupon-art");
    const image = safeImage(coupon?.imageUrl);
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      art.append(img);
    } else {
      art.append(element("span", "coupon-art-label", text(coupon?.type === "gift" ? "coupons.typeGift" : "coupons.typeDiscount")));
    }
    const body = element("div", "coupon-body");
    const head = element("div", "coupon-head");
    head.append(element("span", "coupon-type", text(coupon?.type === "gift" ? "coupons.typeGift" : "coupons.typeDiscount")), element("code", "coupon-code", code || coupon?.code || ""));
    body.append(head, element("strong", "coupon-title", coupon?.title || code || ""));
    if (coupon?.description) body.append(element("p", "coupon-description", coupon.description));
    if (coupon) {
      const meta = [...summaryParts(coupon), Number(coupon.expiresAt) > 0 ? text("coupons.expires", { date: formatDate(coupon.expiresAt) }) : ""].filter(Boolean);
      body.append(element("p", "coupon-summary", meta.join(" · ")));
    }
    extra.forEach((node) => node && body.append(node));
    card.append(art, body);
    return card;
  }

  async function loadCoupon(code, force = false) {
    if (!force && couponCache.has(code)) return couponCache.get(code);
    const snapshot = await db().collection("coupons").doc(code).get();
    const coupon = snapshot.exists ? { code, ...snapshot.data() } : null;
    couponCache.set(code, coupon);
    return coupon;
  }

  // ---------- 兌換頁 ----------

  const redeemStatus = $("#coupon-redeem-status");
  const preview = $("#coupon-preview");
  const codeInput = $("#coupon-code");

  function setRedeemStatus(message, kind = "") {
    redeemStatus.textContent = message || "";
    redeemStatus.dataset.kind = kind;
  }

  function mine(code) {
    return myCoupons.find((item) => item.code === code) || null;
  }

  function couponProblem(coupon) {
    if (!coupon) return text("coupons.notFound");
    if (coupon.active !== true) return text("coupons.inactive");
    if (isExpired(coupon)) return text("coupons.expired");
    if (Number(coupon.maxUses) > 0 && Number(coupon.usedCount) >= Number(coupon.maxUses)) return text("coupons.soldOut");
    return "";
  }

  async function lookup(rawCode) {
    const code = normalizeCode(rawCode);
    codeInput.value = code;
    preview.hidden = true;
    previewCoupon = null;
    if (!currentUser || !db()) return setRedeemStatus(text("coupons.loginFirst"), "error");
    if (!CODE_PATTERN.test(code)) return setRedeemStatus(text("coupons.notFound"), "error");
    setRedeemStatus(text("coupons.looking"), "info");
    let coupon;
    try {
      coupon = await loadCoupon(code, true);
    } catch (error) {
      return setRedeemStatus(text("coupons.claimError", { message: error.message }), "error");
    }
    if (!coupon) return setRedeemStatus(text("coupons.notFound"), "error");
    previewCoupon = coupon;
    const owned = mine(code);
    const problem = owned ? text("coupons.alreadyMine") : couponProblem(coupon);
    const extra = [];
    if (Number(coupon.maxUses) > 0) extra.push(element("p", "coupon-remaining", text("coupons.remaining", { count: Math.max(0, coupon.maxUses - coupon.usedCount) })));
    if (!problem) {
      const button = element("button", "admin-primary-button coupon-claim", text(coupon.type === "gift" ? "coupons.claimGift" : "coupons.claimDiscount"));
      button.type = "button";
      button.addEventListener("click", () => claim(coupon, button));
      extra.push(button);
    }
    preview.replaceChildren(couponCard(coupon, { extra }));
    preview.hidden = false;
    setRedeemStatus(problem, problem ? (owned ? "info" : "error") : "");
  }

  function giftOrder(coupon, orderId) {
    const now = Date.now();
    const product = (window.eloProductCatalog || []).find((item) => item.listingId === coupon.listingId);
    const inspect = window.eloItemDetails?.safeInspect(product?.details);
    return {
      type: "gift",
      uid: currentUser.uid,
      buyerName: String(window.eloUserProfile?.displayName || currentUser.displayName || currentUser.email?.split("@")[0] || "玩家").slice(0, 30),
      tradeUrl: window.eloUserProfile.tradeUrl,
      items: [{
        listingId: coupon.listingId,
        name: coupon.listingName || product?.name || "",
        price: 0,
        quantity: 1,
        imageUrl: safeImage(product?.iconUrl) || safeImage(coupon.imageUrl),
        ...(inspect ? { inspect } : {})
      }],
      offerItems: [],
      total: 0,
      offerTotal: 0,
      note: "",
      adminNote: "",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      subtotal: 0,
      discount: 0,
      couponCode: coupon.code,
      _id: orderId
    };
  }

  function requireTradeUrl() {
    if (window.eloUserProfile?.tradeUrl) return true;
    setRedeemStatus(text("coupons.needTradeUrl"), "error");
    return false;
  }

  async function notifyGift(order, orderId) {
    await window.eloOrders?.notify("admin", text("notifications.newOrderTitle"), text("notifications.newOrderBody", {
      name: order.buyerName,
      type: text("orders.typeGift"),
      total: "0"
    }), "#admin", orderId).catch(() => {});
  }

  // 領取：使用次數 +1、建立自己的券；禮品券同時建立禮品訂單（全部同一批寫入）
  async function claim(coupon, button) {
    if (!currentUser || !db()) return;
    if (coupon.type === "gift" && !requireTradeUrl()) return;
    button.disabled = true;
    setRedeemStatus(text("coupons.claiming"), "info");
    const now = Date.now();
    const batch = db().batch();
    const couponRef = db().collection("coupons").doc(coupon.code);
    const mineRef = db().collection("userCoupons").doc(`${currentUser.uid}_${coupon.code}`);
    batch.update(couponRef, { usedCount: (Number(coupon.usedCount) || 0) + 1 });
    let order = null;
    let orderRef = null;
    if (coupon.type === "gift") {
      orderRef = db().collection("orders").doc();
      order = giftOrder(coupon, orderRef.id);
      delete order._id;
      batch.set(orderRef, order);
    }
    batch.set(mineRef, {
      uid: currentUser.uid,
      code: coupon.code,
      type: coupon.type,
      used: Boolean(orderRef),
      orderId: orderRef ? orderRef.id : "",
      redeemedAt: now,
      usedAt: orderRef ? now : 0
    });
    try {
      await batch.commit();
      couponCache.delete(coupon.code);
      if (order) await notifyGift(order, orderRef.id);
      setRedeemStatus(text(coupon.type === "gift" ? "coupons.claimedGift" : "coupons.claimedDiscount"), "success");
      toast(text(coupon.type === "gift" ? "coupons.claimedGift" : "coupons.claimedDiscount"));
      button.remove();
    } catch (error) {
      button.disabled = false;
      setRedeemStatus(text("coupons.claimError", { message: error.message }), "error");
    }
  }

  // 禮品訂單被取消後，券會還回來，可以重新兌換
  async function regift(code, button) {
    const coupon = await loadCoupon(code, true).catch(() => null);
    const problem = coupon ? (coupon.active !== true ? text("coupons.inactive") : isExpired(coupon) ? text("coupons.expired") : "") : text("coupons.notFound");
    if (problem) return toast(problem);
    if (!window.eloUserProfile?.tradeUrl) return toast(text("coupons.needTradeUrl"));
    button.disabled = true;
    const orderRef = db().collection("orders").doc();
    const order = giftOrder(coupon, orderRef.id);
    delete order._id;
    const batch = db().batch();
    batch.set(orderRef, order);
    batch.update(db().collection("userCoupons").doc(`${currentUser.uid}_${code}`), { used: true, orderId: orderRef.id, usedAt: Date.now() });
    try {
      await batch.commit();
      await notifyGift(order, orderRef.id);
      toast(text("coupons.claimedGift"));
    } catch (error) {
      button.disabled = false;
      toast(text("coupons.claimError", { message: error.message }));
    }
  }

  function couponState(item, coupon) {
    if (item.used) return item.orderId ? text("coupons.stateUsedOrder", { id: shortId(item.orderId) }) : text("coupons.stateUsed");
    if (!coupon || coupon.active !== true) return text("coupons.stateInactive");
    if (isExpired(coupon)) return text("coupons.stateExpired");
    return text("coupons.stateUsable");
  }

  function usable(item) {
    const coupon = couponCache.get(item.code);
    return !item.used && coupon && coupon.active === true && !isExpired(coupon);
  }

  function renderMine() {
    const list = $("#my-coupons-list");
    const sorted = [...myCoupons].sort((a, b) => (b.redeemedAt || 0) - (a.redeemedAt || 0));
    list.replaceChildren(...sorted.map((item) => {
      const coupon = couponCache.get(item.code) || null;
      const state = element("span", `coupon-state${usable(item) ? " is-usable" : ""}`, couponState(item, coupon));
      const extra = [state];
      if (usable(item) && item.type === "discount") extra.push(element("small", "coupon-hint", text("coupons.useInCart")));
      if (usable(item) && item.type === "gift") {
        const button = element("button", "admin-primary-button coupon-claim", text("coupons.regift"));
        button.type = "button";
        button.addEventListener("click", () => regift(item.code, button));
        extra.push(button);
      }
      const card = couponCard(coupon || { type: item.type, code: item.code }, { code: item.code, extra });
      card.classList.toggle("is-spent", !usable(item));
      return card;
    }));
    $("#my-coupons-count").textContent = sorted.length;
    $("#my-coupons-empty").hidden = sorted.length > 0;
    const count = myCoupons.filter(usable).length;
    $("#profile-coupons-count").textContent = count ? text("coupons.usableCount", { count }) : "";
    renderCartCoupon();
  }

  $("#coupon-redeem-form").addEventListener("submit", (event) => {
    event.preventDefault();
    lookup(codeInput.value);
  });

  // 分享連結：#redeem?code=XXXX
  function codeFromHash() {
    const match = /^#redeem\?(.*)$/.exec(location.hash);
    return match ? normalizeCode(new URLSearchParams(match[1]).get("code")) : "";
  }

  let pendingLinkCode = "";
  function handleRedeemLink() {
    const code = codeFromHash();
    if (!code) return;
    codeInput.value = code;
    if (currentUser && db()) {
      pendingLinkCode = "";
      lookup(code);
    } else {
      pendingLinkCode = code;
    }
  }

  window.addEventListener("elopagechange", (event) => {
    if (event.detail?.page === "redeem") handleRedeemLink();
  });

  // ---------- 購物車選券 ----------

  function cartSubtotal() {
    return (window.eloApp?.cartEntries?.() || []).reduce((sum, { product, quantity }) => sum + (product && Number.isFinite(product.price) ? product.price * quantity : 0), 0);
  }

  function renderCartCoupon() {
    const box = $("#cart-coupon");
    if (!box) return;
    const subtotal = cartSubtotal();
    const options = myCoupons.filter((item) => item.type === "discount" && usable(item));
    box.hidden = !currentUser || !options.length || subtotal <= 0;
    const select = $("#cart-coupon-select");
    if (!options.some((item) => item.code === cartSelection)) cartSelection = "";
    const none = new Option(text("coupons.cartNone"), "");
    select.replaceChildren(none, ...options.map((item) => {
      const coupon = couponCache.get(item.code);
      const discount = discountFor(coupon, subtotal);
      const need = Math.max(0, (Number(coupon.minSubtotal) || 0) - subtotal);
      const option = new Option(discount > 0
        ? text("coupons.cartOption", { title: coupon.title, discount: discount.toLocaleString() })
        : text("coupons.cartOptionUnavailable", { title: coupon.title, reason: text("coupons.cartNeedMore", { need: need.toLocaleString() }) }), item.code);
      option.disabled = discount <= 0;
      if (discount <= 0 && cartSelection === item.code) cartSelection = "";
      return option;
    }));
    select.value = cartSelection;
    const discount = cartSelection ? discountFor(couponCache.get(cartSelection), subtotal) : 0;
    $("#cart-discount-lines").hidden = !discount;
    $("#cart-subtotal").textContent = `${subtotal.toLocaleString()} EC`;
    $("#cart-discount").textContent = `−${discount.toLocaleString()} EC`;
    $("#cart-total").textContent = (subtotal - discount).toLocaleString();
  }

  $("#cart-coupon-select").addEventListener("change", (event) => {
    cartSelection = event.target.value;
    renderCartCoupon();
  });
  window.addEventListener("elocartrender", renderCartCoupon);

  // orders.js 結帳時呼叫
  function cartCoupon(subtotal) {
    if (!cartSelection) return null;
    const item = mine(cartSelection);
    const coupon = couponCache.get(cartSelection);
    const discount = discountFor(coupon, subtotal);
    if (!item || !usable(item) || discount <= 0) {
      cartSelection = "";
      renderCartCoupon();
      return { error: text("coupons.couponGone") };
    }
    return { code: cartSelection, discount };
  }

  // ---------- 管理頁 ----------

  const adminForm = $("#admin-coupon-form");
  const fields = {
    type: $("#coupon-type"),
    code: $("#coupon-new-code"),
    title: $("#coupon-title"),
    description: $("#coupon-description"),
    image: $("#coupon-image"),
    mode: $("#coupon-mode"),
    value: $("#coupon-value"),
    maxDiscount: $("#coupon-max-discount"),
    min: $("#coupon-min"),
    gift: $("#coupon-gift"),
    maxUses: $("#coupon-max-uses"),
    expires: $("#coupon-expires"),
    active: $("#coupon-active")
  };
  const adminStatus = $("#coupon-create-status");

  function setAdminStatus(message, kind = "") {
    adminStatus.textContent = message || "";
    adminStatus.dataset.kind = kind;
  }

  function randomCode() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const values = crypto.getRandomValues(new Uint32Array(8));
    return `ELO-${[...values].map((value) => letters[value % letters.length]).join("")}`;
  }

  function updateAdminForm() {
    const gift = fields.type.value === "gift";
    const percent = fields.mode.value === "percent";
    document.querySelectorAll("[data-coupon-for]").forEach((field) => {
      const target = field.dataset.couponFor;
      field.hidden = target === "gift" ? !gift : gift || (target === "percent" && !percent);
    });
    $("#coupon-value-label").textContent = text(percent ? "coupons.adminPercent" : "coupons.adminAmount");
    fields.value.max = percent ? "100" : "10000000";
  }

  function renderGiftOptions() {
    const current = fields.gift.value;
    const sorted = [...adminListings].sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
    if (!sorted.length) {
      fields.gift.replaceChildren(new Option(text("coupons.adminGiftNone"), ""));
      return;
    }
    fields.gift.replaceChildren(...sorted.map((listing) => new Option(
      [listing.name, listing.listed === false ? text("coupons.adminUnlisted") : "", text("coupons.adminStock", { stock: Number(listing.stock) || 0 })].filter(Boolean).join(" · "),
      listing.id
    )));
    if (sorted.some((listing) => listing.id === current)) fields.gift.value = current;
  }

  function wholeNumber(input, fallback = 0) {
    const raw = String(input.value).trim();
    if (raw === "") return fallback;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : NaN;
  }

  adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin || !adminVerified || !db()) return;
    const code = normalizeCode(fields.code.value);
    fields.code.value = code;
    if (!CODE_PATTERN.test(code)) return setAdminStatus(text("coupons.adminCodeInvalid"), "error");
    const title = fields.title.value.trim();
    if (!title) return setAdminStatus(text("coupons.adminTitleRequired"), "error");
    const imageUrl = fields.image.value.trim();
    if (imageUrl && !/^https:\/\/.+/.test(imageUrl)) return setAdminStatus(text("coupons.adminImageInvalid"), "error");
    const type = fields.type.value === "gift" ? "gift" : "discount";
    const percentMode = fields.mode.value === "percent";
    const value = wholeNumber(fields.value);
    const data = {
      code,
      type,
      title: title.slice(0, 40),
      description: fields.description.value.trim().slice(0, 200),
      imageUrl,
      percent: type === "discount" && percentMode ? value : 0,
      amount: type === "discount" && !percentMode ? value : 0,
      maxDiscount: type === "discount" && percentMode ? wholeNumber(fields.maxDiscount) : 0,
      minSubtotal: type === "discount" ? wholeNumber(fields.min) : 0,
      listingId: "",
      listingName: "",
      maxUses: wholeNumber(fields.maxUses),
      usedCount: 0,
      expiresAt: fields.expires.value ? new Date(`${fields.expires.value}T23:59:59`).getTime() : 0,
      active: fields.active.checked,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (type === "discount" && (!Number.isInteger(value) || value <= 0 || (percentMode && value > 100))) return setAdminStatus(text("coupons.adminValueInvalid"), "error");
    if ([data.maxDiscount, data.minSubtotal, data.maxUses].some((number) => Number.isNaN(number))) return setAdminStatus(text("coupons.adminValueInvalid"), "error");
    if (type === "gift") {
      const listing = adminListings.find((item) => item.id === fields.gift.value);
      if (!listing) return setAdminStatus(text("coupons.adminGiftRequired"), "error");
      data.listingId = listing.id;
      data.listingName = String(listing.name || "").slice(0, 100);
      if (!data.imageUrl && safeImage(listing.imageUrl)) data.imageUrl = listing.imageUrl;
    }
    const submit = $("#coupon-submit");
    submit.disabled = true;
    setAdminStatus(text("coupons.adminSaving"), "info");
    try {
      const reference = db().collection("coupons").doc(code);
      if ((await reference.get()).exists) {
        setAdminStatus(text("coupons.adminCodeTaken"), "error");
        return;
      }
      await reference.set(data);
      setAdminStatus(text("coupons.adminCreated", { code }), "success");
      adminForm.reset();
      fields.code.value = randomCode();
      updateAdminForm();
    } catch (error) {
      setAdminStatus(text("coupons.adminError", { message: error.message }), "error");
    } finally {
      submit.disabled = false;
    }
  });

  fields.type.addEventListener("change", updateAdminForm);
  fields.mode.addEventListener("change", updateAdminForm);
  $("#coupon-random").addEventListener("click", () => { fields.code.value = randomCode(); });
  fields.code.value = randomCode();
  updateAdminForm();

  function redeemLink(code) {
    return `${location.origin}${location.pathname}#redeem?code=${encodeURIComponent(code)}`;
  }

  async function copyText(value, button) {
    try {
      await navigator.clipboard.writeText(value);
      const label = button.textContent;
      button.textContent = text("coupons.adminCopied");
      setTimeout(() => { button.textContent = label; }, 1500);
    } catch {
      window.prompt("", value);
    }
  }

  function armConfirm(button, confirmKey, resetKey) {
    if (button.classList.contains("is-confirming")) {
      clearTimeout(confirmTimers.get(button));
      return true;
    }
    button.classList.add("is-confirming");
    button.textContent = text(confirmKey);
    confirmTimers.set(button, setTimeout(() => {
      button.classList.remove("is-confirming");
      button.textContent = text(resetKey);
    }, 3000));
    return false;
  }

  function adminButton(label, className, onClick) {
    const button = element("button", className, label);
    button.type = "button";
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  function renderAdminCoupons() {
    const list = $("#admin-coupon-list");
    const sorted = [...adminCoupons].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.replaceChildren(...sorted.map((coupon) => {
      const usage = element("p", "coupon-usage", [
        text("coupons.adminUsage", { used: Number(coupon.usedCount) || 0, max: Number(coupon.maxUses) > 0 ? coupon.maxUses : text("coupons.adminUnlimited") }),
        Number(coupon.expiresAt) > 0 ? text("coupons.expires", { date: formatDate(coupon.expiresAt) }) : text("coupons.noExpiry")
      ].join(" · "));
      const state = element("span", `coupon-state${coupon.active && !isExpired(coupon) ? " is-usable" : ""}`,
        isExpired(coupon) ? text("coupons.stateExpired") : text(coupon.active ? "coupons.adminActiveLabel" : "coupons.adminInactiveLabel"));
      const actions = element("div", "coupon-actions");
      actions.append(
        adminButton(text("coupons.adminCopyCode"), "admin-ghost-button", (button) => copyText(coupon.code, button)),
        adminButton(text("coupons.adminCopyLink"), "admin-ghost-button", (button) => copyText(redeemLink(coupon.code), button)),
        adminButton(text(coupon.active ? "coupons.adminDisable" : "coupons.adminEnable"), "admin-ghost-button", async (button) => {
          button.disabled = true;
          try {
            await db().collection("coupons").doc(coupon.code).update({ active: !coupon.active, updatedAt: Date.now() });
          } catch (error) {
            toast(text("coupons.adminError", { message: error.message }));
            button.disabled = false;
          }
        }),
        adminButton(text("coupons.adminDelete"), "admin-faq-delete", async (button) => {
          if (!armConfirm(button, "coupons.adminDeleteConfirm", "coupons.adminDelete")) return;
          button.disabled = true;
          try {
            await db().collection("coupons").doc(coupon.code).delete();
          } catch (error) {
            toast(text("coupons.adminError", { message: error.message }));
            button.disabled = false;
          }
        })
      );
      const card = couponCard(coupon, { extra: [state, usage, actions] });
      card.classList.toggle("is-spent", !coupon.active || isExpired(coupon));
      return card;
    }));
    $("#admin-coupon-empty").hidden = sorted.length > 0;
  }

  function startAdmin() {
    if (adminStarted || !isAdmin || !adminVerified || !db()) return;
    adminStarted = true;
    listeners.push(db().collection("coupons").onSnapshot((snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ code: document.id, ...document.data() }));
      adminCoupons = next;
      renderAdminCoupons();
    }, (error) => console.warn("Coupons unavailable:", error)));
    listeners.push(db().collection("listings").onSnapshot((snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
      adminListings = next;
      renderGiftOptions();
    }, (error) => console.warn("Listings unavailable:", error)));
  }

  // ---------- 監聽 ----------

  function stopListeners() {
    listeners.forEach((stop) => { if (typeof stop === "function") stop(); });
    listeners = [];
    myCoupons = [];
    adminStarted = false;
    cartSelection = "";
  }

  function startListeners() {
    stopListeners();
    renderMine();
    if (!currentUser || !db()) return;
    listeners.push(db().collection("userCoupons").where("uid", "==", currentUser.uid).onSnapshot(async (snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
      await Promise.all(next.map((item) => loadCoupon(item.code).catch(() => null)));
      myCoupons = next;
      renderMine();
    }, (error) => console.warn("User coupons unavailable:", error)));
    startAdmin();
    if (pendingLinkCode) handleRedeemLink();
  }

  window.addEventListener("eloauthchange", (event) => {
    const detail = event.detail || {};
    const nextUser = detail.user || null;
    const changed = nextUser?.uid !== currentUser?.uid || Boolean(detail.isAdmin) !== isAdmin || Boolean(detail.emailVerified) !== adminVerified;
    currentUser = nextUser;
    isAdmin = Boolean(detail.isAdmin);
    adminVerified = Boolean(detail.emailVerified);
    if (changed) startListeners();
  });

  window.addEventListener("elofirebaseready", () => {
    if (currentUser) startListeners();
  });

  window.eloCoupons = { cartCoupon, clearCartCoupon: () => { cartSelection = ""; }, discountFor };
  if (location.hash.startsWith("#redeem")) handleRedeemLink();
})();

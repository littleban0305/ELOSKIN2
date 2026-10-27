(() => {
  const text = window.eloText;
  const $ = (selector) => document.querySelector(selector);
  const TWD_PER_EC = 0.03;
  const STATUSES = ["pending", "processing", "completed", "cancelled"];
  const OPEN_STATUSES = ["pending", "processing"];

  let currentUser = null;
  let isAdmin = false;
  let adminVerified = false;
  let listeners = [];
  let userOrders = [];
  let adminOrders = [];
  const notificationSources = { user: new Map(), admin: new Map() };
  const seenNotificationIds = new Set();
  const primedSources = new Set();
  let promptShownThisPage = false;
  const confirmTimers = new WeakMap();

  const app = () => window.eloApp;
  const db = () => window.eloFirebaseDb || null;
  const toast = (message) => app()?.showToast(message);

  // ---------- Helpers ----------

  function statusLabel(status) {
    const key = { pending: "Pending", processing: "Processing", completed: "Completed", cancelled: "Cancelled" }[status] || "Pending";
    return text(`orders.status${key}`);
  }

  function typeLabel(type) {
    return type === "trade" ? text("orders.typeTrade") : text("orders.typePurchase");
  }

  function shortId(id) {
    return String(id).slice(-6).toUpperCase();
  }

  function formatTime(ms) {
    const date = new Date(Number(ms) || 0);
    return date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function formatTwd(ec) {
    return (Math.round(ec * TWD_PER_EC * 100) / 100).toLocaleString();
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function buyerName() {
    const profileName = window.eloUserProfile?.displayName;
    return String(profileName || currentUser?.displayName || currentUser?.email?.split("@")[0] || "玩家").slice(0, 30);
  }

  function armConfirm(button, confirmKey, resetKey) {
    if (button.classList.contains("is-confirming")) {
      window.clearTimeout(confirmTimers.get(button));
      return true;
    }
    button.classList.add("is-confirming");
    button.textContent = text(confirmKey);
    confirmTimers.set(button, window.setTimeout(() => {
      button.classList.remove("is-confirming");
      button.textContent = text(resetKey);
    }, 3000));
    return false;
  }

  async function notify(to, title, body, link, orderId) {
    await db().collection("notifications").add({
      to,
      from: currentUser.uid,
      title: String(title).slice(0, 100),
      body: String(body).slice(0, 300),
      link,
      orderId: orderId || "",
      read: false,
      createdAt: Date.now()
    });
  }

  function requireSignedIn(statusElement) {
    if (currentUser && db()) return true;
    if (statusElement) {
      statusElement.textContent = text("orders.loginRequired");
      statusElement.dataset.kind = "error";
    }
    toast(text("orders.loginRequired"));
    app()?.closeCart?.();
    $("#profile-shortcut")?.click();
    return false;
  }

  function requireTradeUrl(statusElement) {
    if (window.eloUserProfile?.tradeUrl) return true;
    if (statusElement) {
      statusElement.textContent = text("orders.profileRequired");
      statusElement.dataset.kind = "error";
    }
    toast(text("orders.profileRequired"));
    app()?.closeCart?.();
    history.pushState(null, "", "#profile");
    app()?.navigateTo("profile");
    return false;
  }

  function orderCharge(order) {
    const total = Number(order.total) || 0;
    return order.type === "trade" ? Math.max(0, total - (Number(order.offerTotal) || 0)) : total;
  }

  function openOrdersCharge() {
    return userOrders.filter((order) => OPEN_STATUSES.includes(order.status)).reduce((sum, order) => sum + orderCharge(order), 0);
  }

  function hasEnoughBalance(charge, statusElement) {
    const available = window.eloWallet?.available?.() ?? 0;
    if (charge <= available) return true;
    const message = text("orders.insufficientBalance", { need: charge.toLocaleString(), available: available.toLocaleString() });
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.dataset.kind = "error";
    }
    toast(message);
    return false;
  }

  function orderItem(product, quantity) {
    return {
      listingId: product.listingId || "",
      name: product.name,
      price: product.price,
      quantity,
      imageUrl: product.iconUrl || ""
    };
  }

  async function createOrder(order) {
    const reference = await db().collection("orders").add(order);
    await notify("admin", text("notifications.newOrderTitle"), text("notifications.newOrderBody", {
      name: order.buyerName,
      type: typeLabel(order.type),
      total: order.total.toLocaleString()
    }), "#admin", reference.id);
    return reference;
  }

  // ---------- Submitting orders ----------

  async function submitPurchase() {
    const status = $("#cart-status");
    if (!requireSignedIn(status) || !requireTradeUrl(status)) return;
    const entries = app().cartEntries();
    if (!entries.length) return;
    for (const { product, quantity } of entries) {
      if (!Number.isInteger(product.price)) {
        status.textContent = text("orders.unpriced", { name: product.name });
        status.dataset.kind = "error";
        return;
      }
      if (product.stock < quantity) {
        status.textContent = text("orders.stockShort", { name: product.name });
        status.dataset.kind = "error";
        return;
      }
    }
    const items = entries.map(({ product, quantity }) => orderItem(product, quantity));
    const now = Date.now();
    const order = {
      type: "purchase",
      uid: currentUser.uid,
      buyerName: buyerName(),
      tradeUrl: window.eloUserProfile.tradeUrl,
      items,
      offerItems: [],
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      offerTotal: 0,
      note: $("#cart-note").value.trim().slice(0, 500),
      adminNote: "",
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    if (!hasEnoughBalance(orderCharge(order), status)) return;
    const checkout = $("#checkout");
    checkout.disabled = true;
    status.textContent = text("orders.submitting");
    status.dataset.kind = "info";
    try {
      await createOrder(order);
      app().clearCart();
      $("#cart-note").value = "";
      status.textContent = "";
      app().closeCart();
      toast(text("orders.submitted"));
    } catch (error) {
      status.textContent = text("orders.submitError", { message: error.message });
      status.dataset.kind = "error";
    } finally {
      checkout.disabled = false;
    }
  }

  async function submitTrade() {
    if (!requireSignedIn() || !requireTradeUrl()) return;
    const selection = app().tradeSelection();
    for (const product of selection.receive) {
      if (!Number.isInteger(product.price) || product.stock < 1) {
        toast(text("orders.stockShort", { name: product.name }));
        return;
      }
    }
    const now = Date.now();
    const order = {
      type: "trade",
      uid: currentUser.uid,
      buyerName: buyerName(),
      tradeUrl: window.eloUserProfile.tradeUrl,
      items: selection.receive.map((product) => orderItem(product, 1)),
      offerItems: selection.offer.map((item) => ({
        name: item.name,
        value: Number(item.value) || 0,
        ...(item.assetId ? { assetId: item.assetId, marketHashName: item.marketHashName || "", imageUrl: item.iconUrl || "" } : {})
      })),
      total: selection.receiveTotal,
      offerTotal: selection.offerTotal,
      note: $("#trade-note").value.trim().slice(0, 500),
      adminNote: "",
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    if (!hasEnoughBalance(orderCharge(order))) return;
    const button = $("#trade-submit");
    button.disabled = true;
    try {
      await createOrder(order);
      app().clearTrade();
      $("#trade-note").value = "";
      toast(text("orders.submitted"));
    } catch (error) {
      toast(text("orders.submitError", { message: error.message }));
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Order cards ----------

  function itemRow(item, quantityLabel = true) {
    const row = element("div", "order-item");
    const art = element("div", "order-item-art");
    if (/^https:\/\//.test(item.imageUrl || "")) {
      const image = document.createElement("img");
      image.src = item.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      art.append(image);
    }
    const name = element("span", "order-item-name", item.name);
    name.title = item.name;
    const meta = element("span", "order-item-meta");
    const value = Number.isInteger(item.price) ? item.price : Number(item.value) || 0;
    meta.textContent = [
      quantityLabel && item.quantity > 1 ? text("orders.quantity", { count: item.quantity }) : "",
      value ? `${value.toLocaleString()} EC` : ""
    ].filter(Boolean).join(" · ");
    row.append(art, name, meta);
    return row;
  }

  function itemGroup(labelKey, items, quantityLabel) {
    const group = element("div", "order-group");
    group.append(element("span", "order-group-label", text(labelKey)));
    items.forEach((item) => group.append(itemRow(item, quantityLabel)));
    return group;
  }

  function buildOrderCard(order, mode) {
    const card = element("article", `order-card status-${order.status}`);
    card.dataset.orderId = order.id;

    const head = element("div", "order-head");
    head.append(
      element("strong", "order-number", text("orders.orderNumber", { id: shortId(order.id) })),
      element("span", "order-type", typeLabel(order.type)),
      element("span", `order-status order-status-${order.status}`, statusLabel(order.status)),
      element("time", "order-time", formatTime(order.createdAt))
    );
    card.append(head);

    if (mode === "admin") {
      const buyer = element("div", "order-buyer");
      buyer.append(element("span", "", `${text("orders.buyer")}：${order.buyerName}`));
      if (/^https:\/\/steamcommunity\.com\//.test(order.tradeUrl || "")) {
        const link = element("a", "order-trade-link", text("orders.openTradeUrl"));
        link.href = order.tradeUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        buyer.append(link);
      }
      card.append(buyer);
    }

    const body = element("div", "order-body");
    if (order.type === "trade") {
      body.append(
        itemGroup(mode === "admin" ? "orders.buyerGives" : "orders.youGive", order.offerItems || [], false),
        itemGroup(mode === "admin" ? "orders.buyerGets" : "orders.youGet", order.items || [], false)
      );
    } else {
      body.append(itemGroup(mode === "admin" ? "orders.buyerGets" : "orders.youGet", order.items || [], true));
    }
    card.append(body);

    const totals = element("div", "order-totals");
    if (order.type === "trade") {
      const difference = Math.max(0, (order.total || 0) - (order.offerTotal || 0));
      totals.append(element("span", "", `${text("orders.youGive")} ${Number(order.offerTotal || 0).toLocaleString()} EC`));
      totals.append(element("span", "", `${text("orders.youGet")} ${Number(order.total || 0).toLocaleString()} EC`));
      totals.append(element("strong", "", `${text("orders.difference")} ${difference.toLocaleString()} EC（${text("orders.approxTwd", { twd: formatTwd(difference) })}）`));
    } else {
      totals.append(element("strong", "", `${text("orders.total")} ${Number(order.total || 0).toLocaleString()} EC（${text("orders.approxTwd", { twd: formatTwd(order.total || 0) })}）`));
    }
    card.append(totals);

    if (order.note) {
      const note = element("p", "order-note");
      note.append(element("span", "order-note-label", `${text("orders.buyerNote")}：`), document.createTextNode(order.note));
      card.append(note);
    }
    if (mode === "user" && order.adminNote) {
      const note = element("p", "order-note order-admin-note");
      note.append(element("span", "order-note-label", `${text("orders.adminNote")}：`), document.createTextNode(order.adminNote));
      card.append(note);
    }

    const actions = element("div", "order-actions");
    if (mode === "admin") {
      if (OPEN_STATUSES.includes(order.status)) {
        const noteInput = document.createElement("input");
        noteInput.type = "text";
        noteInput.maxLength = 300;
        noteInput.className = "order-admin-note-input";
        noteInput.placeholder = text("orders.adminNotePlaceholder");
        noteInput.setAttribute("aria-label", text("orders.adminNote"));
        noteInput.value = order.adminNote || "";
        actions.append(noteInput);
        if (order.status === "pending") actions.append(actionButton("processing", "orders.accept", "admin-ghost-button"));
        if (order.status === "processing") actions.append(actionButton("completed", "orders.complete", "admin-primary-button"));
        actions.append(actionButton("cancelled", "orders.cancel", "admin-faq-delete"));
      } else if (order.adminNote) {
        const note = element("p", "order-note order-admin-note");
        note.append(element("span", "order-note-label", `${text("orders.adminNote")}：`), document.createTextNode(order.adminNote));
        card.append(note);
      }
    } else if (order.status === "pending") {
      actions.append(actionButton("cancelled", "orders.cancel", "admin-faq-delete"));
    }
    const status = element("span", "order-action-status");
    status.setAttribute("role", "status");
    actions.append(status);
    if (actions.children.length > 1) card.append(actions);
    return card;
  }

  function actionButton(nextStatus, labelKey, className) {
    const button = element("button", className, text(labelKey));
    button.type = "button";
    button.dataset.orderAction = nextStatus;
    button.dataset.labelKey = labelKey;
    return button;
  }

  function renderProfileOrders() {
    const list = $("#profile-orders-list");
    const sorted = [...userOrders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.replaceChildren(...sorted.map((order) => buildOrderCard(order, "user")));
    $("#profile-orders-count").textContent = sorted.length;
    $("#profile-orders-empty").hidden = sorted.length > 0;
  }

  function renderAdminOrders() {
    const filter = $("#admin-order-filter").value;
    const list = $("#admin-order-list");
    if (list.contains(document.activeElement) && document.activeElement.matches("input")) return;
    const matching = adminOrders
      .filter((order) => filter === "all" || (filter === "open" ? OPEN_STATUSES.includes(order.status) : order.status === filter))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.replaceChildren(...matching.map((order) => buildOrderCard(order, "admin")));
    $("#admin-order-empty").hidden = matching.length > 0;
    $("#admin-order-count").textContent = text("orders.count", { total: matching.length });
    const pending = adminOrders.filter((order) => order.status === "pending").length;
    const badge = $("#admin-orders-badge");
    badge.textContent = pending;
    badge.hidden = pending === 0;
  }

  $("#admin-order-filter").addEventListener("change", renderAdminOrders);

  async function completeOrder(transaction, reference, order) {
    const fresh = await transaction.get(reference);
    if (!fresh.exists || fresh.data().status !== "processing") throw new Error("order_changed");
    const totals = new Map();
    for (const item of order.items || []) {
      if (!item.listingId) continue;
      totals.set(item.listingId, (totals.get(item.listingId) || 0) + (Number(item.quantity) || 1));
    }
    const listingReferences = [...totals.keys()].map((id) => db().collection("listings").doc(id));
    const listingSnapshots = [];
    for (const listingReference of listingReferences) listingSnapshots.push(await transaction.get(listingReference));
    const walletReference = db().collection("wallets").doc(order.uid);
    const wallet = await transaction.get(walletReference);
    const balance = wallet.exists ? Number(wallet.data().balance) || 0 : 0;
    const charge = orderCharge(order);
    if (balance < charge) {
      throw new Error(text("orders.buyerInsufficient", { balance: balance.toLocaleString(), charge: charge.toLocaleString() }));
    }

    const now = Date.now();
    let clamped = false;
    listingSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const stock = Number(snapshot.data().stock) || 0;
      const quantity = totals.get(listingReferences[index].id);
      if (stock < quantity) clamped = true;
      transaction.update(listingReferences[index], { stock: Math.max(0, stock - quantity), updatedAt: now });
    });
    if (charge > 0) {
      transaction.set(walletReference, { balance: balance - charge, updatedAt: now });
      transaction.set(db().collection("walletTransactions").doc(), {
        uid: order.uid,
        amount: -charge,
        balanceAfter: balance - charge,
        type: order.type,
        refId: order.id,
        note: text("orders.ledgerNote", { type: typeLabel(order.type), id: shortId(order.id) }),
        createdAt: now
      });
    }
    return { clamped, now };
  }

  async function changeStatus(card, nextStatus, mode) {
    const order = (mode === "admin" ? adminOrders : userOrders).find((item) => item.id === card.dataset.orderId);
    if (!order) return;
    const status = card.querySelector(".order-action-status");
    const buttons = card.querySelectorAll("[data-order-action]");
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = text("orders.updating");
    status.dataset.kind = "info";
    const adminNote = mode === "admin" ? (card.querySelector(".order-admin-note-input")?.value.trim().slice(0, 300) || "") : order.adminNote || "";
    const reference = db().collection("orders").doc(order.id);
    try {
      let clamped = false;
      if (mode === "admin" && nextStatus === "completed") {
        await db().runTransaction(async (transaction) => {
          const result = await completeOrder(transaction, reference, order);
          clamped = result.clamped;
          transaction.update(reference, { status: nextStatus, adminNote, updatedAt: result.now });
        });
      } else if (mode === "admin") {
        await reference.update({ status: nextStatus, adminNote, updatedAt: Date.now() });
      } else {
        await reference.update({ status: "cancelled", updatedAt: Date.now() });
      }
      if (mode === "admin") {
        const action = text({ processing: "notifications.actionProcessing", completed: "notifications.actionCompleted", cancelled: "notifications.actionCancelled" }[nextStatus]);
        const values = { type: typeLabel(order.type), id: shortId(order.id), action, note: adminNote };
        await notify(order.uid, text("notifications.statusTitle", { status: statusLabel(nextStatus) }),
          text(adminNote ? "notifications.statusBodyWithNote" : "notifications.statusBody", values), "#profile", order.id);
      } else {
        await notify("admin", text("notifications.cancelledTitle"),
          text("notifications.cancelledBody", { name: order.buyerName, id: shortId(order.id) }), "#admin", order.id);
      }
      if (clamped) toast(text("orders.stockClamped"));
    } catch (error) {
      status.textContent = text("orders.updateError", { message: error.message });
      status.dataset.kind = "error";
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function handleOrderClick(mode) {
    return (event) => {
      const button = event.target.closest("[data-order-action]");
      if (!button) return;
      const card = button.closest(".order-card");
      const nextStatus = button.dataset.orderAction;
      if (nextStatus === "cancelled" && !armConfirm(button, "orders.cancelConfirm", button.dataset.labelKey)) return;
      changeStatus(card, nextStatus, mode);
    };
  }

  $("#admin-order-list").addEventListener("click", handleOrderClick("admin"));
  $("#profile-orders-list").addEventListener("click", handleOrderClick("user"));

  // ---------- Notifications ----------

  function allNotifications() {
    return [...notificationSources.user.values(), ...notificationSources.admin.values()]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderNotifications() {
    const items = allNotifications();
    const unread = items.filter((item) => !item.read).length;
    const badge = $("#notification-count");
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
    $("#notifications-guest").hidden = Boolean(currentUser);
    $("#notifications-read-all").hidden = !currentUser || unread === 0;
    const list = $("#notification-list");
    list.hidden = !currentUser;
    list.replaceChildren(...items.map((item) => {
      const row = element("button", `notification-item${item.read ? "" : " is-unread"}`);
      row.type = "button";
      row.dataset.notificationId = item.id;
      row.dataset.source = item.source;
      const dot = element("span", "notification-dot");
      dot.setAttribute("aria-hidden", "true");
      const content = element("span", "notification-content");
      content.append(element("strong", "", item.title), element("span", "", item.body));
      row.append(dot, content, element("time", "notification-time", formatTime(item.createdAt)));
      return row;
    }));
    $("#notifications-empty").hidden = !currentUser || items.length > 0;
  }

  function markRead(item) {
    if (item.read) return Promise.resolve();
    item.read = true;
    return db().collection("notifications").doc(item.id).update({ read: true }).catch((error) => {
      console.warn("Mark notification read failed:", error);
    });
  }

  $("#notification-list").addEventListener("click", (event) => {
    const row = event.target.closest("[data-notification-id]");
    if (!row) return;
    const item = notificationSources[row.dataset.source]?.get(row.dataset.notificationId);
    if (!item) return;
    markRead(item);
    renderNotifications();
    if (item.link && /^#[a-z]+$/.test(item.link)) {
      history.pushState(null, "", item.link);
      window.dispatchEvent(new Event("hashchange"));
      if (item.link === "#admin") $("#admin-tab-orders")?.click();
    }
  });

  $("#notifications-read-all").addEventListener("click", async () => {
    await Promise.all(allNotifications().filter((item) => !item.read).map(markRead));
    renderNotifications();
  });

  $("#notifications-login").addEventListener("click", () => $("#profile-shortcut")?.click());

  function showSystemNotification(item) {
    toast(item.title);
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const notification = new Notification(item.title, { body: item.body, icon: "assets/logo/logo.png", tag: item.id });
      notification.onclick = () => {
        window.focus();
        history.pushState(null, "", "#notifications");
        window.dispatchEvent(new Event("hashchange"));
        notification.close();
      };
    } catch (error) {
      console.warn("System notification failed:", error);
    }
  }

  function handleNotificationSnapshot(source, snapshot) {
    const map = notificationSources[source];
    map.clear();
    const fresh = [];
    snapshot.forEach((document) => {
      const data = document.data();
      const item = {
        id: document.id,
        source,
        title: String(data.title || ""),
        body: String(data.body || ""),
        link: String(data.link || ""),
        read: data.read === true,
        createdAt: Number(data.createdAt) || 0
      };
      map.set(item.id, item);
      if (!seenNotificationIds.has(item.id)) {
        seenNotificationIds.add(item.id);
        if (primedSources.has(source) && !item.read) fresh.push(item);
      }
    });
    primedSources.add(source);
    fresh.forEach(showSystemNotification);
    renderNotifications();
  }

  // ---------- System notification prompt ----------

  function maybeShowPrompt() {
    if (promptShownThisPage || !currentUser || !("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    promptShownThisPage = true;
    const denied = Notification.permission === "denied";
    $("#notify-prompt-text").textContent = text(denied ? "notifications.promptDenied" : "notifications.promptText");
    $("#notify-prompt-allow").hidden = denied;
    $("#notify-prompt-later").textContent = text(denied ? "notifications.promptOk" : "notifications.promptLater");
    $("#notify-prompt").hidden = false;
  }

  $("#notify-prompt-allow").addEventListener("click", async () => {
    $("#notify-prompt").hidden = true;
    try {
      await Notification.requestPermission();
    } catch (error) {
      console.warn("Notification permission request failed:", error);
    }
  });

  $("#notify-prompt-later").addEventListener("click", () => {
    $("#notify-prompt").hidden = true;
  });

  // ---------- Listeners ----------

  function stopListeners() {
    listeners.forEach((stop) => { if (typeof stop === "function") stop(); });
    listeners = [];
    userOrders = [];
    adminOrders = [];
    notificationSources.user.clear();
    notificationSources.admin.clear();
    primedSources.clear();
  }

  function startListeners() {
    stopListeners();
    if (!currentUser || !db()) {
      renderProfileOrders();
      renderNotifications();
      return;
    }
    const uid = currentUser.uid;
    listeners.push(db().collection("orders").where("uid", "==", uid).onSnapshot((snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
      userOrders = next;
      renderProfileOrders();
      window.dispatchEvent(new Event("eloordersupdated"));
    }, (error) => console.warn("Orders unavailable:", error)));
    listeners.push(db().collection("notifications").where("to", "==", uid).onSnapshot(
      (snapshot) => handleNotificationSnapshot("user", snapshot),
      (error) => console.warn("Notifications unavailable:", error)
    ));
    if (isAdmin && adminVerified) {
      listeners.push(db().collection("orders").onSnapshot((snapshot) => {
        const next = [];
        snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
        adminOrders = next;
        renderAdminOrders();
      }, (error) => console.warn("Admin orders unavailable:", error)));
      listeners.push(db().collection("notifications").where("to", "==", "admin").onSnapshot(
        (snapshot) => handleNotificationSnapshot("admin", snapshot),
        (error) => console.warn("Admin notifications unavailable:", error)
      ));
    }
    renderNotifications();
  }

  window.addEventListener("eloauthchange", (event) => {
    const detail = event.detail || {};
    const nextUser = detail.user || null;
    const changed = nextUser?.uid !== currentUser?.uid || Boolean(detail.isAdmin) !== isAdmin
      || Boolean(detail.emailVerified) !== adminVerified;
    currentUser = nextUser;
    isAdmin = Boolean(detail.isAdmin);
    adminVerified = Boolean(detail.emailVerified);
    $("#open-notifications").hidden = !currentUser;
    if (changed) startListeners();
    maybeShowPrompt();
  });

  window.addEventListener("elofirebaseready", () => {
    if (currentUser) startListeners();
  });

  window.addEventListener("elopagechange", (event) => {
    if (event.detail?.page === "notifications") renderNotifications();
  });

  window.eloOrders = { submitPurchase, submitTrade, notify, openOrdersCharge };
  renderNotifications();
})();

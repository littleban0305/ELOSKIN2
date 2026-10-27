(() => {
  const text = window.eloText;
  const $ = (selector) => document.querySelector(selector);
  const TWD_PER_EC = 0.03;
  const MAX_ATTACHMENTS = 3;
  const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
  const MAX_DATA_URL_LENGTH = 850000;
  const OPEN_ORDER_STATUSES = ["pending", "processing"];

  let currentUser = null;
  let isAdmin = false;
  let adminVerified = false;
  let listeners = [];
  let balance = 0;
  let walletLoaded = false;
  let ledger = [];
  let myTopups = [];
  let adminTopups = [];
  let pendingFiles = [];
  const confirmTimers = new WeakMap();

  const db = () => window.eloFirebaseDb || null;
  const toast = (message) => window.eloApp?.showToast(message);

  // ---------- Helpers ----------

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function formatTime(ms) {
    return new Date(Number(ms) || 0).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function twd(ec) {
    return (Math.round(ec * TWD_PER_EC * 100) / 100).toLocaleString();
  }

  function shortId(id) {
    return String(id).slice(-6).toUpperCase();
  }

  function userName() {
    return String(window.eloUserProfile?.displayName || currentUser?.displayName || currentUser?.email?.split("@")[0] || "玩家").slice(0, 30);
  }

  function openOrdersCharge() {
    return window.eloOrders?.openOrdersCharge?.() || 0;
  }

  function available() {
    return Math.max(0, balance - openOrdersCharge());
  }

  function statusLabel(status) {
    return text({ pending: "wallet.statusPending", approved: "wallet.statusApproved", rejected: "wallet.statusRejected", cancelled: "wallet.statusCancelled" }[status] || "wallet.statusPending");
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

  async function notify(to, title, body, link, refId) {
    await window.eloOrders.notify(to, title, body, link, refId);
  }

  // ---------- Header chip & wallet page ----------

  function renderChip() {
    const chip = $("#wallet-chip");
    chip.hidden = !currentUser;
    $("#wallet-chip-amount").textContent = balance.toLocaleString();
  }

  function renderWalletPage() {
    $("#wallet-guest").hidden = Boolean(currentUser);
    $("#wallet-content").hidden = !currentUser;
    if (!currentUser) return;
    $("#wallet-balance").textContent = balance.toLocaleString();
    $("#wallet-balance-twd").textContent = text("wallet.approxTwd", { twd: twd(balance) });
    const reserved = openOrdersCharge();
    $("#wallet-available").textContent = available().toLocaleString();
    $("#wallet-reserved").textContent = reserved.toLocaleString();
    $("#wallet-reserved-row").hidden = reserved === 0;

    const ledgerList = $("#wallet-ledger");
    const sortedLedger = [...ledger].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    ledgerList.replaceChildren(...sortedLedger.map((entry) => {
      const row = element("div", "wallet-ledger-row");
      const amount = Number(entry.amount) || 0;
      row.append(
        element("span", "wallet-ledger-note", entry.note || ""),
        element("time", "wallet-ledger-time", formatTime(entry.createdAt)),
        element("strong", amount >= 0 ? "is-income" : "is-expense", `${amount >= 0 ? "+" : ""}${amount.toLocaleString()} EC`)
      );
      return row;
    }));
    $("#wallet-ledger-empty").hidden = sortedLedger.length > 0;

    const topupList = $("#wallet-topups");
    const sortedTopups = [...myTopups].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    topupList.replaceChildren(...sortedTopups.map((topup) => buildTopupCard(topup, "user")));
    $("#wallet-topups-empty").hidden = sortedTopups.length > 0;
  }

  // ---------- Top-up form ----------

  const topupForm = $("#topup-form");
  const topupMessage = $("#topup-message");
  const topupTwd = $("#topup-twd");
  const topupEc = $("#topup-ec");
  const topupFiles = $("#topup-files");
  const topupPreviews = $("#topup-previews");
  const topupStatus = $("#topup-status");

  function setTopupStatus(key, kind, values) {
    topupStatus.textContent = key ? text(key, values) : "";
    topupStatus.dataset.kind = kind || "";
  }

  // 全形數字、逗號、單位文字都先整理掉；空白回傳 null，看不懂回傳 NaN
  function parseAmount(raw) {
    const cleaned = String(raw || "")
      .replace(/[０-９．，]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
      .replace(/[,\s]|NT\$|元|EC/gi, "")
      .trim();
    if (cleaned === "") return null;
    const value = Number(cleaned);
    return Number.isFinite(value) && value >= 0 ? value : NaN;
  }

  topupTwd.addEventListener("input", () => {
    const value = parseAmount(topupTwd.value);
    topupEc.value = value === null || Number.isNaN(value) ? "" : String(Math.round(value / TWD_PER_EC));
  });
  topupEc.addEventListener("input", () => {
    const value = parseAmount(topupEc.value);
    topupTwd.value = value === null || Number.isNaN(value) ? "" : String(Math.round(value * TWD_PER_EC * 100) / 100);
  });

  document.querySelectorAll("[data-topup-method]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      document.querySelectorAll("[data-topup-method]").forEach((other) => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
    });
  });

  async function compressImage(file) {
    const image = await createImageBitmap(file);
    let maxSide = 1600;
    let quality = 0.82;
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
        maxSide = Math.round(maxSide * 0.8);
        quality = Math.max(0.5, quality - 0.08);
      }
    } finally {
      image.close?.();
    }
    throw new Error(text("wallet.imageTooLarge"));
  }

  function renderPreviews() {
    topupPreviews.replaceChildren(...pendingFiles.map((file, index) => {
      const item = element("div", "topup-preview");
      const image = document.createElement("img");
      image.src = file.dataUrl;
      image.alt = file.name;
      const remove = element("button", "", "×");
      remove.type = "button";
      remove.dataset.removeAttachment = String(index);
      remove.setAttribute("aria-label", text("wallet.removeAttachment", { name: file.name }));
      item.append(image, remove);
      return item;
    }));
    $("#topup-file-button").disabled = pendingFiles.length >= MAX_ATTACHMENTS;
  }

  $("#topup-file-button").addEventListener("click", () => topupFiles.click());

  topupFiles.addEventListener("change", async () => {
    const files = [...(topupFiles.files || [])];
    topupFiles.value = "";
    for (const file of files) {
      if (pendingFiles.length >= MAX_ATTACHMENTS) {
        setTopupStatus("wallet.attachmentLimit", "error");
        break;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setTopupStatus("wallet.attachmentType", "error");
        continue;
      }
      if (file.size > MAX_SOURCE_BYTES) {
        setTopupStatus("wallet.imageTooLarge", "error");
        continue;
      }
      try {
        pendingFiles.push({ name: file.name.slice(0, 100), dataUrl: await compressImage(file) });
        setTopupStatus("");
      } catch (error) {
        setTopupStatus("wallet.attachmentError", "error", { message: error.message });
      }
    }
    renderPreviews();
  });

  topupPreviews.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-attachment]");
    if (!button) return;
    pendingFiles.splice(Number(button.dataset.removeAttachment), 1);
    renderPreviews();
  });

  topupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser || !db()) {
      setTopupStatus("wallet.loginRequired", "error");
      return;
    }
    const message = topupMessage.value.trim();
    if (!message) {
      setTopupStatus("wallet.messageRequired", "error");
      topupMessage.focus();
      return;
    }
    let parsedEc = parseAmount(topupEc.value);
    if (parsedEc === null) {
      const parsedTwd = parseAmount(topupTwd.value);
      parsedEc = parsedTwd === null ? 0 : Number.isNaN(parsedTwd) ? NaN : parsedTwd / TWD_PER_EC;
    }
    const requestedAmount = Math.round(parsedEc);
    if (Number.isNaN(parsedEc) || requestedAmount > 100000000) {
      setTopupStatus("wallet.amountInvalid", "error", { value: topupEc.value || topupTwd.value });
      topupEc.focus();
      return;
    }
    const submit = $("#topup-submit");
    submit.disabled = true;
    setTopupStatus("wallet.submitting", "info");
    try {
      const now = Date.now();
      const reference = await db().collection("topups").add({
        uid: currentUser.uid,
        userName: userName(),
        message: message.slice(0, 1000),
        requestedAmount,
        attachmentCount: pendingFiles.length,
        status: "pending",
        creditedAmount: 0,
        adminNote: "",
        createdAt: now,
        updatedAt: now
      });
      for (let index = 0; index < pendingFiles.length; index += 1) {
        await reference.collection("attachments").doc(String(index)).set({
          dataUrl: pendingFiles[index].dataUrl,
          name: pendingFiles[index].name,
          createdAt: Date.now()
        });
      }
      await notify("admin", text("wallet.notifyNewTitle"), text("wallet.notifyNewBody", {
        name: userName(),
        amount: requestedAmount ? `${requestedAmount.toLocaleString()} EC` : text("wallet.amountUnspecified")
      }), "#admin", reference.id);
      topupForm.reset();
      pendingFiles = [];
      renderPreviews();
      setTopupStatus("wallet.submitted", "success");
    } catch (error) {
      setTopupStatus("wallet.submitError", "error", { message: error.message });
    } finally {
      submit.disabled = false;
    }
  });

  // ---------- Top-up cards ----------

  function buildTopupCard(topup, mode) {
    const card = element("article", `order-card topup-card status-${topup.status === "approved" ? "completed" : topup.status === "rejected" || topup.status === "cancelled" ? "cancelled" : "pending"}`);
    card.dataset.topupId = topup.id;
    const head = element("div", "order-head");
    head.append(
      element("strong", "order-number", text("wallet.requestNumber", { id: shortId(topup.id) })),
      element("span", `order-status topup-status-${topup.status}`, statusLabel(topup.status)),
      element("time", "order-time", formatTime(topup.createdAt))
    );
    card.append(head);
    if (mode === "admin") card.append(element("div", "order-buyer", `${text("wallet.applicant")}：${topup.userName}`));

    const message = element("p", "order-note");
    message.append(element("span", "order-note-label", `${text("wallet.messageLabel")}：`), document.createTextNode(topup.message || ""));
    card.append(message);

    const amounts = element("div", "order-totals");
    amounts.append(element("span", "", `${text("wallet.requested")} ${topup.requestedAmount ? `${Number(topup.requestedAmount).toLocaleString()} EC（${text("wallet.approxTwd", { twd: twd(topup.requestedAmount) })}）` : text("wallet.amountUnspecified")}`));
    if (topup.status === "approved") amounts.append(element("strong", "", `${text("wallet.credited")} ${Number(topup.creditedAmount || 0).toLocaleString()} EC`));
    card.append(amounts);

    if (topup.attachmentCount > 0) {
      const attachments = element("div", "topup-attachments");
      const button = element("button", "admin-ghost-button", text("wallet.viewAttachments", { count: topup.attachmentCount }));
      button.type = "button";
      button.dataset.loadAttachments = topup.id;
      attachments.append(button);
      card.append(attachments);
    }

    if (topup.adminNote && (mode === "user" || topup.status !== "pending")) {
      const note = element("p", "order-note order-admin-note");
      note.append(element("span", "order-note-label", `${text("wallet.adminNote")}：`), document.createTextNode(topup.adminNote));
      card.append(note);
    }

    const actions = element("div", "order-actions");
    if (mode === "admin" && topup.status === "pending") {
      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.min = "0";
      amountInput.step = "1";
      amountInput.inputMode = "numeric";
      amountInput.className = "order-admin-note-input topup-credit-input";
      amountInput.placeholder = text("wallet.creditPlaceholder");
      amountInput.setAttribute("aria-label", text("wallet.creditPlaceholder"));
      amountInput.value = topup.requestedAmount ? String(topup.requestedAmount) : "";
      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.maxLength = 300;
      noteInput.className = "order-admin-note-input topup-note-input";
      noteInput.placeholder = text("wallet.adminNotePlaceholder");
      noteInput.setAttribute("aria-label", text("wallet.adminNote"));
      const approve = element("button", "admin-primary-button", text("wallet.approve"));
      approve.type = "button";
      approve.dataset.topupAction = "approve";
      const reject = element("button", "admin-faq-delete", text("wallet.reject"));
      reject.type = "button";
      reject.dataset.topupAction = "reject";
      reject.dataset.labelKey = "wallet.reject";
      actions.append(amountInput, noteInput, approve, reject);
    } else if (mode === "user" && topup.status === "pending") {
      const cancel = element("button", "admin-faq-delete", text("wallet.cancel"));
      cancel.type = "button";
      cancel.dataset.topupAction = "cancel";
      cancel.dataset.labelKey = "wallet.cancel";
      actions.append(cancel);
    }
    const status = element("span", "order-action-status");
    status.setAttribute("role", "status");
    actions.append(status);
    if (actions.children.length > 1) card.append(actions);
    return card;
  }

  async function loadAttachments(button) {
    const card = button.closest(".topup-card");
    const container = button.parentElement;
    button.disabled = true;
    button.textContent = text("wallet.loadingAttachments");
    try {
      const snapshot = await db().collection("topups").doc(card.dataset.topupId).collection("attachments").get();
      const images = [];
      snapshot.forEach((document) => {
        const data = document.data();
        if (/^data:image\/(jpeg|png|webp);base64,/.test(data.dataUrl || "")) images.push(data);
      });
      container.replaceChildren(...images.map((data) => {
        const thumb = element("button", "topup-thumb");
        thumb.type = "button";
        thumb.dataset.lightbox = "";
        const image = document.createElement("img");
        image.src = data.dataUrl;
        image.alt = data.name || "";
        thumb.append(image);
        return thumb;
      }));
    } catch (error) {
      button.disabled = false;
      button.textContent = text("wallet.attachmentError", { message: error.message });
    }
  }

  function handleTopupClick(mode) {
    return async (event) => {
      const loadButton = event.target.closest("[data-load-attachments]");
      if (loadButton) {
        loadAttachments(loadButton);
        return;
      }
      const thumb = event.target.closest("[data-lightbox]");
      if (thumb) {
        $("#lightbox-image").src = thumb.querySelector("img").src;
        $("#lightbox").hidden = false;
        return;
      }
      const button = event.target.closest("[data-topup-action]");
      if (!button) return;
      const card = button.closest(".topup-card");
      const action = button.dataset.topupAction;
      if ((action === "reject" || action === "cancel") && !armConfirm(button, "wallet.confirm", button.dataset.labelKey)) return;
      const topup = (mode === "admin" ? adminTopups : myTopups).find((item) => item.id === card.dataset.topupId);
      if (!topup) return;
      const status = card.querySelector(".order-action-status");
      const buttons = card.querySelectorAll("[data-topup-action]");
      const fail = (message) => {
        status.textContent = message;
        status.dataset.kind = "error";
        buttons.forEach((item) => { item.disabled = false; });
      };
      buttons.forEach((item) => { item.disabled = true; });
      status.textContent = text("wallet.updating");
      status.dataset.kind = "info";
      const reference = db().collection("topups").doc(topup.id);
      try {
        if (action === "cancel") {
          await reference.update({ status: "cancelled", updatedAt: Date.now() });
          return;
        }
        const adminNote = card.querySelector(".topup-note-input")?.value.trim().slice(0, 300) || "";
        if (action === "reject") {
          await reference.update({ status: "rejected", adminNote, updatedAt: Date.now() });
          await notify(topup.uid, text("wallet.notifyRejectedTitle"), adminNote
            ? text("wallet.notifyRejectedBodyNote", { id: shortId(topup.id), note: adminNote })
            : text("wallet.notifyRejectedBody", { id: shortId(topup.id) }), "#wallet", topup.id);
          return;
        }
        const amount = Number(card.querySelector(".topup-credit-input").value.trim());
        if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) {
          fail(text("wallet.creditInvalid"));
          return;
        }
        const walletReference = db().collection("wallets").doc(topup.uid);
        const ledgerReference = db().collection("walletTransactions").doc();
        await db().runTransaction(async (transaction) => {
          const fresh = await transaction.get(reference);
          if (!fresh.exists || fresh.data().status !== "pending") throw new Error(text("wallet.alreadyHandled"));
          const wallet = await transaction.get(walletReference);
          const current = wallet.exists ? Number(wallet.data().balance) || 0 : 0;
          const now = Date.now();
          transaction.set(walletReference, { balance: current + amount, updatedAt: now });
          transaction.set(ledgerReference, {
            uid: topup.uid,
            amount,
            balanceAfter: current + amount,
            type: "topup",
            refId: topup.id,
            note: text("wallet.ledgerTopup", { id: shortId(topup.id) }),
            createdAt: now
          });
          transaction.update(reference, { status: "approved", creditedAmount: amount, adminNote, updatedAt: now });
        });
        await notify(topup.uid, text("wallet.notifyApprovedTitle"), text(adminNote ? "wallet.notifyApprovedBodyNote" : "wallet.notifyApprovedBody", {
          id: shortId(topup.id), amount: amount.toLocaleString(), note: adminNote
        }), "#wallet", topup.id);
      } catch (error) {
        fail(text("wallet.updateError", { message: error.message }));
      }
    };
  }

  $("#wallet-topups").addEventListener("click", handleTopupClick("user"));
  $("#admin-topup-list").addEventListener("click", handleTopupClick("admin"));
  $("#admin-topup-filter").addEventListener("change", renderAdminTopups);

  $("#lightbox").addEventListener("click", () => {
    $("#lightbox").hidden = true;
    $("#lightbox-image").removeAttribute("src");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#lightbox").hidden) $("#lightbox").click();
  });

  function renderAdminTopups() {
    const list = $("#admin-topup-list");
    if (list.contains(document.activeElement) && document.activeElement.matches("input")) return;
    const filter = $("#admin-topup-filter").value;
    const matching = adminTopups
      .filter((topup) => filter === "all" || topup.status === filter)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.replaceChildren(...matching.map((topup) => buildTopupCard(topup, "admin")));
    $("#admin-topup-empty").hidden = matching.length > 0;
    $("#admin-topup-count").textContent = text("orders.count", { total: matching.length });
    const pending = adminTopups.filter((topup) => topup.status === "pending").length;
    $("#admin-topups-badge").textContent = pending;
    $("#admin-topups-badge").hidden = pending === 0;
  }

  // ---------- Listeners ----------

  function stopListeners() {
    listeners.forEach((stop) => { if (typeof stop === "function") stop(); });
    listeners = [];
    balance = 0;
    walletLoaded = false;
    ledger = [];
    myTopups = [];
    adminTopups = [];
  }

  function startListeners() {
    stopListeners();
    renderChip();
    renderWalletPage();
    if (!currentUser || !db()) return;
    const uid = currentUser.uid;
    listeners.push(db().collection("wallets").doc(uid).onSnapshot((snapshot) => {
      balance = snapshot.exists ? Math.max(0, Number(snapshot.data().balance) || 0) : 0;
      walletLoaded = true;
      renderChip();
      renderWalletPage();
    }, (error) => console.warn("Wallet unavailable:", error)));
    listeners.push(db().collection("walletTransactions").where("uid", "==", uid).onSnapshot((snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
      ledger = next;
      renderWalletPage();
    }, (error) => console.warn("Wallet history unavailable:", error)));
    listeners.push(db().collection("topups").where("uid", "==", uid).onSnapshot((snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
      myTopups = next;
      renderWalletPage();
    }, (error) => console.warn("Top-ups unavailable:", error)));
    if (isAdmin && adminVerified) {
      listeners.push(db().collection("topups").onSnapshot((snapshot) => {
        const next = [];
        snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
        adminTopups = next;
        renderAdminTopups();
      }, (error) => console.warn("Admin top-ups unavailable:", error)));
    }
  }

  window.addEventListener("eloauthchange", (event) => {
    const detail = event.detail || {};
    const nextUser = detail.user || null;
    const changed = nextUser?.uid !== currentUser?.uid || Boolean(detail.isAdmin) !== isAdmin
      || Boolean(detail.emailVerified) !== adminVerified;
    currentUser = nextUser;
    isAdmin = Boolean(detail.isAdmin);
    adminVerified = Boolean(detail.emailVerified);
    if (changed) startListeners();
    else {
      renderChip();
      renderWalletPage();
    }
  });

  window.addEventListener("elofirebaseready", () => { if (currentUser) startListeners(); });
  window.addEventListener("eloordersupdated", renderWalletPage);
  window.addEventListener("elopagechange", (event) => {
    if (event.detail?.page === "wallet") renderWalletPage();
  });
  $("#wallet-login").addEventListener("click", () => $("#profile-shortcut")?.click());

  window.eloWallet = {
    balance: () => balance,
    available,
    loaded: () => walletLoaded
  };
  renderChip();
  renderWalletPage();
})();

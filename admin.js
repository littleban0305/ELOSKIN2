(() => {
  const text = window.eloText;
  const $ = (selector) => document.querySelector(selector);
  const SAVE_DELAY_MS = 700;
  const MAX_ROWS = 100;
  const FAQ_LIMIT = 50;

  const productList = $("#admin-product-list");
  const productSearch = $("#admin-product-search");
  const productFilter = $("#admin-product-filter");
  const productCount = $("#admin-product-count");
  const productEmpty = $("#admin-product-empty");
  const faqList = $("#admin-faq-list");
  const faqAddButton = $("#admin-faq-add");
  const saveIndicator = $("#admin-save-indicator");
  const notice = $("#admin-notice");
  const noticeText = $("#admin-notice-text");
  const verifyButton = $("#admin-verify-email");

  let currentUser = null;
  let isAdmin = false;
  let emailVerified = false;
  let activeSaves = 0;
  let failedSaves = 0;
  let productRenderQueued = false;
  let faqItems = [];
  let faqLoaded = false;
  let faqTimer = null;
  let faqSaving = false;
  const productTimers = new Map();
  const deleteConfirmTimers = new WeakMap();

  function db() {
    return window.eloFirebaseDb || null;
  }

  function canEdit() {
    return isAdmin && emailVerified && Boolean(db());
  }

  function visibilityId(product) {
    return window.eloProductVisibilityId(product);
  }

  function overrideId(product) {
    return encodeURIComponent(visibilityId(product));
  }

  function hiddenIds() {
    return window.eloHiddenProductIds || new Set();
  }

  // ---------- Save indicator ----------

  function pendingCount() {
    return productTimers.size + (faqTimer ? 1 : 0) + activeSaves;
  }

  function updateSaveIndicator() {
    if (pendingCount() > 0) {
      saveIndicator.textContent = text("admin.saving");
      saveIndicator.dataset.kind = "info";
    } else if (failedSaves > 0) {
      saveIndicator.textContent = text("admin.saveFailed");
      saveIndicator.dataset.kind = "error";
    } else {
      saveIndicator.textContent = text("admin.allSaved");
      saveIndicator.dataset.kind = "success";
    }
  }

  async function trackSave(task) {
    activeSaves += 1;
    updateSaveIndicator();
    try {
      await task();
      return true;
    } catch (error) {
      console.warn("Admin save failed:", error);
      return error;
    } finally {
      activeSaves -= 1;
      updateSaveIndicator();
    }
  }

  // ---------- Notice ----------

  function updateNotice() {
    let message = "";
    if (!db()) message = text("admin.firestoreUnavailable");
    else if (!emailVerified) message = text("admin.emailUnverified");
    else if (window.eloCatalogVisibility?.error) {
      message = text("admin.catalogError", { message: window.eloCatalogVisibility.error });
    }
    notice.hidden = !message;
    noticeText.textContent = message;
    verifyButton.hidden = !isAdmin || emailVerified || !db();
  }

  verifyButton.addEventListener("click", async () => {
    try {
      await window.eloFirebaseAuth.currentUser.sendEmailVerification();
      noticeText.textContent = text("admin.verificationSent");
    } catch (error) {
      noticeText.textContent = text("admin.verificationError", { message: error.message });
    }
  });

  // ---------- Tabs ----------

  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-admin-tab]").forEach((other) => {
        const active = other === tab;
        other.classList.toggle("active", active);
        other.setAttribute("aria-selected", String(active));
        document.getElementById(other.getAttribute("aria-controls")).hidden = !active;
      });
    });
  });

  // ---------- Products ----------

  function catalogEntries() {
    const entries = new Map();
    for (const product of window.eloProductCatalog || []) {
      const key = visibilityId(product);
      const entry = entries.get(key);
      if (entry) entry.stock += Number(product.stock) || 0;
      else entries.set(key, { product, stock: Number(product.stock) || 0 });
    }
    return [...entries.values()];
  }

  function matchesFilter({ product }) {
    const term = productSearch.value.trim().toLocaleLowerCase("zh-Hant");
    const haystack = `${product.name} ${product.baseName} ${product.category} ${product.game}`.toLocaleLowerCase("zh-Hant");
    if (term && !haystack.includes(term)) return false;
    const hidden = hiddenIds().has(visibilityId(product));
    switch (productFilter.value) {
      case "listed": return !hidden;
      case "unlisted": return hidden;
      case "unpriced": return !Number.isFinite(product.price);
      default: return true;
    }
  }

  function editingInside(container) {
    const active = document.activeElement;
    return Boolean(active) && container.contains(active) && active.matches("input, textarea");
  }

  function productListBusy() {
    return editingInside(productList) || productTimers.size > 0;
  }

  function queueProductRender() {
    if (productListBusy()) {
      productRenderQueued = true;
      return;
    }
    productRenderQueued = false;
    renderProducts();
  }

  function createField(labelKey, input) {
    const label = document.createElement("label");
    label.className = "admin-field";
    const caption = document.createElement("span");
    caption.className = "admin-field-label";
    caption.textContent = text(labelKey);
    label.append(caption, input);
    return label;
  }

  function productArtElement(product) {
    const wrap = document.createElement("div");
    wrap.className = "admin-product-art";
    if (product.iconUrl) {
      const image = document.createElement("img");
      image.src = product.iconUrl;
      image.alt = "";
      image.loading = "lazy";
      wrap.append(image);
    } else {
      wrap.textContent = product.label || product.category || "";
    }
    return wrap;
  }

  function fillRowValues(row, product) {
    const override = window.eloProductOverrides?.[overrideId(product)];
    row.querySelector("[data-field='name']").value = override?.name || product.baseName || "";
    row.querySelector("[data-field='price']").value = Number.isInteger(override?.price)
      ? override.price
      : Number.isFinite(product.basePrice) ? product.basePrice : "";
    row.querySelector("[data-field='description']").value = override?.description || product.baseDescription || "";
    const hidden = hiddenIds().has(visibilityId(product));
    const toggle = row.querySelector("[data-visibility-toggle]");
    toggle.textContent = hidden ? text("admin.publish") : text("admin.takeDown");
    toggle.classList.toggle("is-hidden", hidden);
    toggle.setAttribute("aria-pressed", String(!hidden));
    row.classList.toggle("is-unlisted", hidden);
    const state = row.querySelector(".admin-row-state");
    state.textContent = hidden ? text("admin.unlisted") : text("admin.listed");
    state.dataset.kind = hidden ? "off" : "on";
  }

  function buildProductRow({ product, stock }) {
    const row = document.createElement("article");
    row.className = "admin-product-row";
    row.dataset.overrideId = overrideId(product);
    row.dataset.visibilityId = visibilityId(product);

    const summary = document.createElement("div");
    summary.className = "admin-product-summary";
    const meta = document.createElement("div");
    meta.className = "admin-product-meta";
    const original = document.createElement("strong");
    original.textContent = product.baseName;
    original.title = product.baseName;
    const details = document.createElement("span");
    details.textContent = [
      product.game,
      product.category,
      product.source === "demo" ? text("admin.demoTag") : text("admin.stockTag", { amount: stock })
    ].filter(Boolean).join(" · ");
    const state = document.createElement("span");
    state.className = "admin-row-state";
    meta.append(original, details, state);
    summary.append(productArtElement(product), meta);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 100;
    nameInput.dataset.field = "name";
    nameInput.placeholder = product.baseName || "";

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.max = "10000000";
    priceInput.step = "1";
    priceInput.inputMode = "numeric";
    priceInput.dataset.field = "price";
    priceInput.placeholder = text("admin.pricePlaceholder");

    const descriptionInput = document.createElement("input");
    descriptionInput.type = "text";
    descriptionInput.maxLength = 500;
    descriptionInput.dataset.field = "description";
    descriptionInput.placeholder = product.baseDescription || text("admin.descriptionPlaceholder");

    const fields = document.createElement("div");
    fields.className = "admin-product-fields";
    fields.append(
      createField("admin.fieldName", nameInput),
      createField("admin.fieldPrice", priceInput),
      createField("admin.fieldDescription", descriptionInput)
    );

    const actions = document.createElement("div");
    actions.className = "admin-product-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "admin-visibility-toggle";
    toggle.dataset.visibilityToggle = "";
    const status = document.createElement("span");
    status.className = "admin-row-status";
    status.setAttribute("role", "status");
    actions.append(toggle, status);

    row.append(summary, fields, actions);
    fillRowValues(row, product);
    const editable = canEdit();
    row.querySelectorAll("input, button").forEach((element) => { element.disabled = !editable; });
    return row;
  }

  function renderProducts() {
    const entries = catalogEntries().filter(matchesFilter);
    const shown = entries.slice(0, MAX_ROWS);
    const fragment = document.createDocumentFragment();
    shown.forEach((entry) => fragment.append(buildProductRow(entry)));
    productList.replaceChildren(fragment);
    productEmpty.hidden = shown.length > 0;
    productCount.textContent = entries.length > MAX_ROWS
      ? text("admin.countLimited", { shown: MAX_ROWS, total: entries.length })
      : text("admin.count", { total: entries.length });
  }

  function syncProductRows() {
    const products = new Map(catalogEntries().map(({ product }) => [overrideId(product), product]));
    productList.querySelectorAll(".admin-product-row").forEach((row) => {
      const product = products.get(row.dataset.overrideId);
      if (!product || editingInside(row) || productTimers.has(row.dataset.overrideId)) return;
      fillRowValues(row, product);
    });
  }

  function findProduct(id) {
    return catalogEntries().map(({ product }) => product).find((product) => overrideId(product) === id);
  }

  function setRowStatus(row, key, kind) {
    const status = row?.querySelector(".admin-row-status");
    if (!status) return;
    status.textContent = key ? text(key) : "";
    status.dataset.kind = kind || "";
  }

  function rowFor(id) {
    return [...productList.querySelectorAll(".admin-product-row")].find((row) => row.dataset.overrideId === id);
  }

  function readRow(row, product) {
    const name = row.querySelector("[data-field='name']").value.trim();
    const description = row.querySelector("[data-field='description']").value.trim();
    const priceValue = row.querySelector("[data-field='price']").value.trim();
    const price = priceValue === "" ? null : Number(priceValue);
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10000000)) {
      return { error: "admin.priceInvalid" };
    }
    return {
      data: {
        name: name === product.baseName ? "" : name,
        description: description === product.baseDescription ? "" : description,
        price: price === product.basePrice ? null : price
      }
    };
  }

  async function saveProduct(id) {
    productTimers.delete(id);
    const row = rowFor(id);
    const product = findProduct(id);
    if (!row || !product || !canEdit()) {
      updateSaveIndicator();
      return;
    }
    const result = readRow(row, product);
    if (result.error) {
      setRowStatus(row, result.error, "error");
      updateSaveIndicator();
      return;
    }
    const { data } = result;
    const reference = db().collection("productOverrides").doc(id);
    const empty = !data.name && !data.description && data.price === null;
    setRowStatus(row, "admin.rowSaving", "info");
    const outcome = await trackSave(() => empty ? reference.delete() : reference.set(data));
    const latestRow = rowFor(id);
    if (outcome === true) {
      failedSaves = 0;
      if (!productTimers.has(id)) setRowStatus(latestRow, "admin.rowSaved", "success");
    } else {
      failedSaves += 1;
      setRowStatus(latestRow, "admin.rowSaveFailed", "error");
    }
    updateSaveIndicator();
    if (productRenderQueued) queueProductRender();
  }

  function scheduleProductSave(id) {
    window.clearTimeout(productTimers.get(id));
    productTimers.set(id, window.setTimeout(() => saveProduct(id), SAVE_DELAY_MS));
    setRowStatus(rowFor(id), "admin.rowEditing", "info");
    updateSaveIndicator();
  }

  function flushProductSave(id) {
    if (!productTimers.has(id)) return;
    window.clearTimeout(productTimers.get(id));
    saveProduct(id);
  }

  productList.addEventListener("input", (event) => {
    const row = event.target.closest(".admin-product-row");
    if (row && event.target.dataset.field) scheduleProductSave(row.dataset.overrideId);
  });

  productList.addEventListener("focusout", (event) => {
    const row = event.target.closest(".admin-product-row");
    if (!row) return;
    window.setTimeout(() => {
      if (row.contains(document.activeElement)) return;
      flushProductSave(row.dataset.overrideId);
      const product = findProduct(row.dataset.overrideId);
      const field = event.target.dataset.field;
      if (product && field && !event.target.value.trim()) {
        if (field === "name") event.target.value = product.baseName || "";
        if (field === "description") event.target.value = product.baseDescription || "";
      }
      if (productRenderQueued) queueProductRender();
    }, 0);
  });

  productList.addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-visibility-toggle]");
    if (!toggle || !canEdit()) return;
    const row = toggle.closest(".admin-product-row");
    const id = row.dataset.visibilityId;
    toggle.disabled = true;
    setRowStatus(row, "admin.rowSaving", "info");
    const reference = db().doc("siteSettings/catalog");
    const outcome = await trackSave(() => db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data().hiddenProductIds || [] : [];
      if (!Array.isArray(current) || current.some((value) => typeof value !== "string")) {
        throw new Error("catalog_visibility_invalid");
      }
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 2000) throw new Error("catalog_visibility_limit_reached");
        next.add(id);
      }
      transaction.set(reference, { hiddenProductIds: [...next] });
    }));
    toggle.disabled = false;
    if (outcome === true) {
      failedSaves = 0;
      setRowStatus(row, "admin.rowSaved", "success");
    } else {
      failedSaves += 1;
      setRowStatus(row, outcome?.message === "catalog_visibility_limit_reached"
        ? "admin.catalogLimit" : "admin.rowSaveFailed", "error");
    }
    updateSaveIndicator();
  });

  productSearch.addEventListener("input", renderProducts);
  productFilter.addEventListener("change", renderProducts);

  // ---------- FAQ ----------

  function defaultFaq() {
    return Object.values(window.ELOSKIN2_TEXT.home.faqItems)
      .map(({ question, answer }) => ({ question, answer }));
  }

  function faqBusy() {
    return faqList.contains(document.activeElement) || Boolean(faqTimer) || faqSaving;
  }

  function loadFaqFromSite(force = false) {
    if (!force && faqLoaded && faqBusy()) return;
    const source = Array.isArray(window.eloFaqItems) ? window.eloFaqItems : defaultFaq();
    faqItems = source.map(({ question, answer }) => ({ question, answer }));
    faqLoaded = true;
    renderFaqEditor();
  }

  function iconButton(action, labelKey, symbol) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-icon-button admin-faq-${action}`;
    button.dataset.faqAction = action;
    button.setAttribute("aria-label", text(labelKey));
    button.title = text(labelKey);
    button.textContent = symbol;
    return button;
  }

  function renderFaqEditor(focus) {
    const editable = canEdit();
    const fragment = document.createDocumentFragment();
    faqItems.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "admin-faq-card";
      card.dataset.index = String(index);

      const header = document.createElement("div");
      header.className = "admin-faq-card-head";
      const number = document.createElement("span");
      number.className = "admin-faq-number";
      number.textContent = text("admin.faqNumber", { number: index + 1 });
      const tools = document.createElement("div");
      tools.className = "admin-faq-tools";
      const up = iconButton("up", "admin.faqMoveUp", "↑");
      const down = iconButton("down", "admin.faqMoveDown", "↓");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "admin-faq-delete";
      remove.dataset.faqAction = "delete";
      remove.textContent = text("admin.faqDelete");
      up.disabled = index === 0;
      down.disabled = index === faqItems.length - 1;
      tools.append(up, down, remove);
      header.append(number, tools);

      const question = document.createElement("input");
      question.type = "text";
      question.maxLength = 200;
      question.dataset.faqField = "question";
      question.placeholder = text("admin.faqQuestionPlaceholder");
      question.value = item.question;

      const answer = document.createElement("textarea");
      answer.rows = 3;
      answer.maxLength = 2000;
      answer.dataset.faqField = "answer";
      answer.placeholder = text("admin.faqAnswerPlaceholder");
      answer.value = item.answer;

      card.append(header, createField("admin.faqQuestion", question), createField("admin.faqAnswer", answer));
      card.querySelectorAll("input, textarea, button").forEach((element) => {
        if (!editable) element.disabled = true;
      });
      fragment.append(card);
    });
    faqList.replaceChildren(fragment);
    if (!faqItems.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = text("admin.faqEmpty");
      faqList.append(empty);
    }
    faqAddButton.disabled = !editable || faqItems.length >= FAQ_LIMIT;
    if (focus) {
      const card = faqList.querySelector(`[data-index="${focus.index}"]`);
      card?.querySelector(focus.selector)?.focus();
    }
  }

  async function saveFaq() {
    faqTimer = null;
    if (!canEdit()) {
      updateSaveIndicator();
      return;
    }
    faqSaving = true;
    const items = faqItems.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() }));
    const outcome = await trackSave(() => db().doc("siteSettings/faq").set({ items }));
    faqSaving = false;
    if (outcome === true) failedSaves = 0;
    else failedSaves += 1;
    updateSaveIndicator();
  }

  function scheduleFaqSave(immediate = false) {
    window.clearTimeout(faqTimer);
    faqTimer = window.setTimeout(saveFaq, immediate ? 0 : SAVE_DELAY_MS);
    updateSaveIndicator();
  }

  faqList.addEventListener("input", (event) => {
    const field = event.target.dataset.faqField;
    const card = event.target.closest(".admin-faq-card");
    if (!field || !card) return;
    faqItems[Number(card.dataset.index)][field] = event.target.value;
    scheduleFaqSave();
  });

  faqList.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (faqList.contains(document.activeElement) || !faqTimer) return;
      window.clearTimeout(faqTimer);
      saveFaq();
    }, 0);
  });

  faqList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-faq-action]");
    if (!button || !canEdit()) return;
    const index = Number(button.closest(".admin-faq-card").dataset.index);
    const action = button.dataset.faqAction;
    if (action === "delete") {
      if (!button.classList.contains("is-confirming")) {
        button.classList.add("is-confirming");
        button.textContent = text("admin.faqDeleteConfirm");
        deleteConfirmTimers.set(button, window.setTimeout(() => {
          button.classList.remove("is-confirming");
          button.textContent = text("admin.faqDelete");
        }, 3000));
        return;
      }
      window.clearTimeout(deleteConfirmTimers.get(button));
      faqItems.splice(index, 1);
      renderFaqEditor();
      scheduleFaqSave(true);
      return;
    }
    const target = action === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= faqItems.length) return;
    [faqItems[index], faqItems[target]] = [faqItems[target], faqItems[index]];
    renderFaqEditor({ index: target, selector: `[data-faq-action="${action}"]` });
    scheduleFaqSave(true);
  });

  faqAddButton.addEventListener("click", () => {
    if (!canEdit() || faqItems.length >= FAQ_LIMIT) return;
    faqItems.push({ question: "", answer: "" });
    renderFaqEditor({ index: faqItems.length - 1, selector: "[data-faq-field='question']" });
    scheduleFaqSave();
  });

  // ---------- Wiring ----------

  function refreshAll() {
    updateNotice();
    queueProductRender();
    if (!faqBusy()) loadFaqFromSite(true);
    updateSaveIndicator();
  }

  window.addEventListener("eloauthchange", (event) => {
    const detail = event.detail || {};
    const changedUser = detail.user?.uid !== currentUser?.uid;
    currentUser = detail.user || null;
    isAdmin = Boolean(detail.isAdmin);
    emailVerified = Boolean(detail.emailVerified);
    if (!isAdmin) return;
    if (changedUser) failedSaves = 0;
    refreshAll();
  });

  window.addEventListener("elofirebaseready", () => { if (isAdmin) refreshAll(); });
  window.addEventListener("catalogproductschange", () => { if (isAdmin) queueProductRender(); });
  window.addEventListener("catalogvisibilitychange", () => {
    if (!isAdmin) return;
    updateNotice();
    if (productFilter.value === "all") syncProductRows();
    else queueProductRender();
  });
  window.addEventListener("productoverrideschange", () => { if (isAdmin) syncProductRows(); });
  window.addEventListener("faqchange", () => { if (isAdmin) loadFaqFromSite(); });

  window.addEventListener("beforeunload", (event) => {
    if (!isAdmin || pendingCount() === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();

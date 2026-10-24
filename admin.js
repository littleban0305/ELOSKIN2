(() => {
  const text = window.eloText;
  const copy = window.ELOSKIN2_TEXT;
  const $ = (selector) => document.querySelector(selector);
  const SAVE_DELAY_MS = 700;
  const MAX_ROWS = 100;
  const FAQ_LIMIT = 50;
  const TAG_LIMIT = 10;
  const TAG_MAX_LENGTH = 20;
  const DEFAULT_TAGS = ["熱門", "新品", "特價", "稀有", "限量"];
  const CATEGORY_KEYS = ["rifle", "sniper", "pistol", "knife", "gloves", "weapon", "case", "item", "competitor", "rivals"];

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
  const tagSuggestions = $("#admin-tag-suggestions");

  const createForm = $("#admin-create-form");
  const createStatus = $("#admin-create-status");
  const createSubmit = $("#admin-create-submit");
  const createArt = $("#admin-create-art");
  const createSourceLabel = $("#admin-create-source");
  const steamPicker = $("#admin-steam-picker");
  const steamGrid = $("#admin-steam-grid");
  const steamSearch = $("#admin-steam-search");
  const steamStatus = $("#admin-steam-status");
  const imageField = $("#admin-create-image-field");

  let currentUser = null;
  let isAdmin = false;
  let emailVerified = false;
  let activeSaves = 0;
  let failedSaves = 0;
  let productRenderQueued = false;
  let listings = [];
  let listingsLoaded = false;
  let listingsError = "";
  let stopListings = null;
  let faqItems = [];
  let faqLoaded = false;
  let faqTimer = null;
  let faqSaving = false;
  let createMode = "custom";
  let steamItems = [];
  let steamLoadState = "idle";
  let selectedSteamItem = null;
  let createTags = null;
  const productTimers = new Map();
  const confirmTimers = new WeakMap();

  function db() {
    return window.eloFirebaseDb || null;
  }

  function canEdit() {
    return isAdmin && emailVerified && Boolean(db());
  }

  // ---------- Shared helpers ----------

  function categoryLabel(key) {
    return typeof copy.categories[key] === "string" ? copy.categories[key] : copy.categories.item;
  }

  function gameLabel(game) {
    return game === "ROBLOX RIVALS" ? copy.games.rivals : copy.games.cs2;
  }

  function detectCategoryKey(name, type) {
    const value = `${name} ${type}`.toLocaleLowerCase("zh-Hant");
    if (/glove|手套/.test(value)) return "gloves";
    if (/knife|刀/.test(value)) return "knife";
    if (/sniper|狙擊/.test(value)) return "sniper";
    if (/rifle|步槍/.test(value)) return "rifle";
    if (/pistol|手槍/.test(value)) return "pistol";
    if (/case|container|箱/.test(value)) return "case";
    if (/agent|探員/.test(value)) return "item";
    if (/smg|shotgun|machine gun|衝鋒槍|霰彈槍|機槍|weapon|武器/.test(value)) return "weapon";
    return "item";
  }

  function createField(labelKey, input, extraClass = "") {
    const label = document.createElement("label");
    label.className = `admin-field ${extraClass}`.trim();
    const caption = document.createElement("span");
    caption.className = "admin-field-label";
    caption.textContent = text(labelKey);
    label.append(caption, input);
    return label;
  }

  function artElement(imageUrl, fallback) {
    const wrap = document.createElement("div");
    wrap.className = "admin-product-art";
    setArt(wrap, imageUrl, fallback);
    return wrap;
  }

  function setArt(wrap, imageUrl, fallback) {
    wrap.replaceChildren();
    if (/^https:\/\//.test(imageUrl || "")) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { wrap.textContent = fallback; });
      wrap.append(image);
    } else {
      wrap.textContent = fallback;
    }
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

  function editingInside(container) {
    const active = document.activeElement;
    return Boolean(active) && container.contains(active) && active.matches("input, textarea, select");
  }

  function parsePrice(value) {
    const trimmed = String(value).trim();
    if (trimmed === "") return { value: null };
    const number = Number(trimmed);
    if (!Number.isInteger(number) || number < 0 || number > 10000000) return { error: "admin.priceInvalid" };
    return { value: number };
  }

  function parseStock(value) {
    const number = Number(String(value).trim() || "0");
    if (!Number.isInteger(number) || number < 0 || number > 100000) return { error: "admin.stockInvalid" };
    return { value: number };
  }

  // ---------- Tag editor ----------

  function refreshTagSuggestions() {
    const tags = new Set(DEFAULT_TAGS);
    listings.forEach((listing) => (listing.tags || []).forEach((tag) => tags.add(tag)));
    tagSuggestions.replaceChildren(...[...tags].map((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      return option;
    }));
  }

  function createTagEditor(initialTags, onChange) {
    let tags = [...initialTags];
    const editor = document.createElement("div");
    editor.className = "admin-tag-editor";
    const chips = document.createElement("div");
    chips.className = "admin-tag-chips";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = TAG_MAX_LENGTH;
    input.placeholder = text("admin.tagsPlaceholder");
    input.setAttribute("list", "admin-tag-suggestions");
    input.dataset.tagInput = "";
    editor.append(chips, input);

    function render() {
      chips.replaceChildren(...tags.map((tag) => {
        const chip = document.createElement("span");
        chip.className = "admin-tag-chip";
        const label = document.createElement("span");
        label.textContent = tag;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", text("admin.tagRemove", { tag }));
        remove.addEventListener("click", () => {
          tags = tags.filter((value) => value !== tag);
          render();
          onChange(tags);
          input.focus();
        });
        chip.append(label, remove);
        return chip;
      }));
      input.disabled = editor.classList.contains("is-disabled");
      input.placeholder = tags.length >= TAG_LIMIT ? text("admin.tagLimit") : text("admin.tagsPlaceholder");
    }

    function commit() {
      const values = input.value.split(/[,，]/).map((value) => value.trim().slice(0, TAG_MAX_LENGTH)).filter(Boolean);
      input.value = "";
      let changed = false;
      for (const value of values) {
        if (tags.length >= TAG_LIMIT || tags.includes(value)) continue;
        tags.push(value);
        changed = true;
      }
      if (changed) {
        render();
        onChange(tags);
      }
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        commit();
      } else if (event.key === "Backspace" && !input.value && tags.length) {
        tags.pop();
        render();
        onChange(tags);
      }
    });
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    render();

    return {
      element: editor,
      getTags: () => [...tags],
      setTags: (next) => { tags = [...next]; render(); },
      setDisabled: (disabled) => {
        editor.classList.toggle("is-disabled", disabled);
        editor.querySelectorAll("input, button").forEach((element) => { element.disabled = disabled; });
      }
    };
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
    else if (listingsError) message = text("admin.listingsError", { message: listingsError });
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

  function showTab(name) {
    document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
      const active = tab.dataset.adminTab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
    });
    if (name === "create" && createMode === "steam" && steamLoadState === "idle") loadSteamInventory();
  }

  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.adminTab));
  });

  // ---------- Listings data ----------

  function startListingsListener() {
    if (stopListings || !canEdit()) return;
    stopListings = db().collection("listings").onSnapshot((snapshot) => {
      const next = [];
      snapshot.forEach((document) => next.push({ id: document.id, ...document.data() }));
      listings = next.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      listingsLoaded = true;
      listingsError = "";
      refreshTagSuggestions();
      updateNotice();
      queueProductRender(true);
      renderSteamGrid();
    }, (error) => {
      listingsLoaded = true;
      listingsError = error.code || error.message;
      updateNotice();
      queueProductRender();
    });
  }

  function stopListingsListener() {
    if (typeof stopListings === "function") stopListings();
    stopListings = null;
    listings = [];
    listingsLoaded = false;
  }

  function listingById(id) {
    return listings.find((listing) => listing.id === id);
  }

  // ---------- Listings manager ----------

  function matchesFilter(listing) {
    const term = productSearch.value.trim().toLocaleLowerCase("zh-Hant");
    const haystack = [listing.name, categoryLabel(listing.category), gameLabel(listing.game), ...(listing.tags || [])]
      .join(" ").toLocaleLowerCase("zh-Hant");
    if (term && !haystack.includes(term)) return false;
    switch (productFilter.value) {
      case "listed": return listing.listed === true;
      case "unlisted": return listing.listed !== true;
      case "unpriced": return !Number.isInteger(listing.price);
      default: return true;
    }
  }

  function productListBusy() {
    return editingInside(productList) || productTimers.size > 0;
  }

  function queueProductRender(syncFirst = false) {
    if (productListBusy()) {
      productRenderQueued = true;
      if (syncFirst) syncProductRows();
      return;
    }
    productRenderQueued = false;
    renderProducts();
  }

  function fillRowValues(row, listing) {
    row.querySelector("[data-field='name']").value = listing.name || "";
    row.querySelector("[data-field='price']").value = Number.isInteger(listing.price) ? listing.price : "";
    row.querySelector("[data-field='stock']").value = Number.isInteger(listing.stock) ? listing.stock : 0;
    row.querySelector("[data-field='description']").value = listing.description || "";
    row.tagEditor?.setTags(listing.tags || []);
    const listed = listing.listed === true;
    const toggle = row.querySelector("[data-visibility-toggle]");
    toggle.textContent = listed ? text("admin.takeDown") : text("admin.publish");
    toggle.classList.toggle("is-hidden", !listed);
    toggle.setAttribute("aria-pressed", String(listed));
    row.classList.toggle("is-unlisted", !listed);
    const state = row.querySelector(".admin-row-state");
    state.textContent = listed ? text("admin.listed") : text("admin.unlisted");
    state.dataset.kind = listed ? "on" : "off";
  }

  function buildProductRow(listing) {
    const row = document.createElement("article");
    row.className = "admin-product-row admin-listing-row";
    row.dataset.listingId = listing.id;

    const summary = document.createElement("div");
    summary.className = "admin-product-summary";
    const meta = document.createElement("div");
    meta.className = "admin-product-meta";
    const title = document.createElement("strong");
    title.textContent = listing.name;
    title.title = listing.name;
    const details = document.createElement("span");
    details.textContent = [
      gameLabel(listing.game),
      categoryLabel(listing.category),
      listing.source === "steam" ? text("admin.sourceSteam") : text("admin.sourceCustom")
    ].join(" · ");
    const state = document.createElement("span");
    state.className = "admin-row-state";
    meta.append(title, details, state);
    summary.append(artElement(listing.imageUrl, categoryLabel(listing.category)), meta);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 100;
    nameInput.dataset.field = "name";
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.max = "10000000";
    priceInput.step = "1";
    priceInput.inputMode = "numeric";
    priceInput.placeholder = text("admin.pricePlaceholder");
    priceInput.dataset.field = "price";
    const stockInput = document.createElement("input");
    stockInput.type = "number";
    stockInput.min = "0";
    stockInput.max = "100000";
    stockInput.step = "1";
    stockInput.inputMode = "numeric";
    stockInput.dataset.field = "stock";
    const descriptionInput = document.createElement("input");
    descriptionInput.type = "text";
    descriptionInput.maxLength = 500;
    descriptionInput.placeholder = text("admin.descriptionPlaceholder");
    descriptionInput.dataset.field = "description";

    const tagEditor = createTagEditor(listing.tags || [], () => scheduleProductSave(listing.id));
    row.tagEditor = tagEditor;

    const fields = document.createElement("div");
    fields.className = "admin-product-fields admin-listing-fields";
    fields.append(
      createField("admin.fieldName", nameInput, "admin-field-name"),
      createField("admin.fieldPrice", priceInput),
      createField("admin.fieldStock", stockInput),
      createField("admin.fieldDescription", descriptionInput, "admin-field-wide"),
      createField("admin.fieldTags", tagEditor.element, "admin-field-wide")
    );

    const actions = document.createElement("div");
    actions.className = "admin-product-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "admin-visibility-toggle";
    toggle.dataset.visibilityToggle = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-faq-delete";
    remove.dataset.listingDelete = "";
    remove.textContent = text("admin.deleteListing");
    const status = document.createElement("span");
    status.className = "admin-row-status";
    status.setAttribute("role", "status");
    actions.append(toggle, remove, status);

    row.append(summary, fields, actions);
    fillRowValues(row, listing);
    const editable = canEdit();
    row.querySelectorAll("input, button").forEach((element) => { element.disabled = !editable; });
    tagEditor.setDisabled(!editable);
    return row;
  }

  function renderProducts() {
    if (!listingsLoaded) {
      productList.replaceChildren();
      productEmpty.hidden = false;
      productEmpty.textContent = canEdit() ? text("admin.listingsLoading") : "";
      productCount.textContent = "";
      return;
    }
    const matching = listings.filter(matchesFilter);
    const shown = matching.slice(0, MAX_ROWS);
    const fragment = document.createDocumentFragment();
    shown.forEach((listing) => fragment.append(buildProductRow(listing)));
    productList.replaceChildren(fragment);
    productEmpty.hidden = shown.length > 0;
    productEmpty.textContent = listings.length ? text("admin.noProducts") : text("admin.listingsEmpty");
    productCount.textContent = matching.length > MAX_ROWS
      ? text("admin.countLimited", { shown: MAX_ROWS, total: matching.length })
      : text("admin.count", { total: matching.length });
  }

  function syncProductRows() {
    productList.querySelectorAll(".admin-listing-row").forEach((row) => {
      const listing = listingById(row.dataset.listingId);
      if (!listing || editingInside(row) || productTimers.has(row.dataset.listingId)) return;
      fillRowValues(row, listing);
    });
  }

  function rowFor(id) {
    return [...productList.querySelectorAll(".admin-listing-row")].find((row) => row.dataset.listingId === id);
  }

  function setRowStatus(row, key, kind) {
    const status = row?.querySelector(".admin-row-status");
    if (!status) return;
    status.textContent = key ? text(key) : "";
    status.dataset.kind = kind || "";
  }

  function readRow(row) {
    const name = row.querySelector("[data-field='name']").value.trim();
    if (!name) return { error: "admin.nameRequired" };
    const price = parsePrice(row.querySelector("[data-field='price']").value);
    if (price.error) return price;
    const stock = parseStock(row.querySelector("[data-field='stock']").value);
    if (stock.error) return stock;
    return {
      data: {
        name,
        price: price.value,
        stock: stock.value,
        description: row.querySelector("[data-field='description']").value.trim(),
        tags: row.tagEditor.getTags(),
        updatedAt: Date.now()
      }
    };
  }

  async function saveListing(id) {
    productTimers.delete(id);
    const row = rowFor(id);
    if (!row || !listingById(id) || !canEdit()) {
      updateSaveIndicator();
      return;
    }
    const result = readRow(row);
    if (result.error) {
      setRowStatus(row, result.error, "error");
      updateSaveIndicator();
      return;
    }
    setRowStatus(row, "admin.rowSaving", "info");
    const outcome = await trackSave(() => db().collection("listings").doc(id).update(result.data));
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
    productTimers.set(id, window.setTimeout(() => saveListing(id), SAVE_DELAY_MS));
    setRowStatus(rowFor(id), "admin.rowEditing", "info");
    updateSaveIndicator();
  }

  function flushProductSave(id) {
    if (!productTimers.has(id)) return;
    window.clearTimeout(productTimers.get(id));
    saveListing(id);
  }

  productList.addEventListener("input", (event) => {
    const row = event.target.closest(".admin-listing-row");
    if (row && event.target.dataset.field) scheduleProductSave(row.dataset.listingId);
  });

  productList.addEventListener("focusout", (event) => {
    const row = event.target.closest(".admin-listing-row");
    if (!row) return;
    window.setTimeout(() => {
      if (editingInside(row)) return;
      flushProductSave(row.dataset.listingId);
      if (productRenderQueued) queueProductRender();
    }, 0);
  });

  productList.addEventListener("click", async (event) => {
    if (!canEdit()) return;
    const row = event.target.closest(".admin-listing-row");
    if (!row) return;
    const id = row.dataset.listingId;
    const listing = listingById(id);
    if (!listing) return;

    const toggle = event.target.closest("[data-visibility-toggle]");
    if (toggle) {
      toggle.disabled = true;
      setRowStatus(row, "admin.rowSaving", "info");
      const outcome = await trackSave(() => db().collection("listings").doc(id)
        .update({ listed: listing.listed !== true, updatedAt: Date.now() }));
      toggle.disabled = false;
      if (outcome === true) {
        failedSaves = 0;
        setRowStatus(rowFor(id), "admin.rowSaved", "success");
      } else {
        failedSaves += 1;
        setRowStatus(rowFor(id), "admin.rowSaveFailed", "error");
      }
      updateSaveIndicator();
      return;
    }

    const remove = event.target.closest("[data-listing-delete]");
    if (remove) {
      if (!armConfirm(remove, "admin.deleteConfirm", "admin.deleteListing")) return;
      window.clearTimeout(productTimers.get(id));
      productTimers.delete(id);
      remove.disabled = true;
      const outcome = await trackSave(() => db().collection("listings").doc(id).delete());
      if (outcome === true) failedSaves = 0;
      else {
        failedSaves += 1;
        remove.disabled = false;
        setRowStatus(rowFor(id), "admin.rowSaveFailed", "error");
      }
      updateSaveIndicator();
    }
  });

  productSearch.addEventListener("input", renderProducts);
  productFilter.addEventListener("change", renderProducts);

  // ---------- Create listing ----------

  const createFields = {
    name: $("#admin-create-name"),
    game: $("#admin-create-game"),
    category: $("#admin-create-category"),
    price: $("#admin-create-price"),
    stock: $("#admin-create-stock"),
    imageUrl: $("#admin-create-image"),
    description: $("#admin-create-description"),
    listed: $("#admin-create-listed")
  };

  createFields.category.replaceChildren(...CATEGORY_KEYS.map((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = categoryLabel(key);
    return option;
  }));
  createFields.game.replaceChildren(...[["CS2", copy.games.cs2], ["ROBLOX RIVALS", copy.games.rivals]].map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));

  createTags = createTagEditor([], () => {});
  $("#admin-create-tags").replaceWith(createTags.element);
  createTags.element.id = "admin-create-tags";

  function setCreateStatus(key, kind, values) {
    createStatus.textContent = key ? text(key, values) : "";
    createStatus.dataset.kind = kind || "";
  }

  function updateCreatePreview() {
    const imageUrl = createMode === "steam" ? selectedSteamItem?.iconUrl : createFields.imageUrl.value.trim();
    setArt(createArt, imageUrl, categoryLabel(createFields.category.value));
    createSourceLabel.textContent = createMode === "steam"
      ? selectedSteamItem ? text("admin.createSourceSteam", { name: selectedSteamItem.name }) : text("admin.steamSelectFirst")
      : text("admin.createSourceCustom");
  }

  function resetCreateForm() {
    createForm.reset();
    createFields.stock.value = "1";
    createFields.listed.checked = true;
    createFields.game.value = "CS2";
    createFields.category.value = "item";
    createTags.setTags([]);
    selectedSteamItem = null;
    steamGrid.querySelectorAll(".is-selected").forEach((element) => element.classList.remove("is-selected"));
    updateCreatePreview();
  }

  function setCreateMode(mode) {
    createMode = mode;
    document.querySelectorAll("[data-create-mode]").forEach((button) => {
      const active = button.dataset.createMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    steamPicker.hidden = mode !== "steam";
    imageField.hidden = mode === "steam";
    setCreateStatus("");
    resetCreateForm();
    if (mode === "steam" && steamLoadState === "idle") loadSteamInventory();
  }

  document.querySelectorAll("[data-create-mode]").forEach((button) => {
    button.addEventListener("click", () => setCreateMode(button.dataset.createMode));
  });

  createFields.imageUrl.addEventListener("input", updateCreatePreview);
  createFields.category.addEventListener("change", updateCreatePreview);

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canEdit()) {
      setCreateStatus("admin.firestoreUnavailable", "error");
      return;
    }
    if (createMode === "steam" && !selectedSteamItem) {
      setCreateStatus("admin.steamSelectFirst", "error");
      return;
    }
    const name = createFields.name.value.trim();
    if (!name) {
      setCreateStatus("admin.nameRequired", "error");
      createFields.name.focus();
      return;
    }
    const price = parsePrice(createFields.price.value);
    if (price.error) {
      setCreateStatus(price.error, "error");
      createFields.price.focus();
      return;
    }
    const stock = parseStock(createFields.stock.value);
    if (stock.error) {
      setCreateStatus(stock.error, "error");
      createFields.stock.focus();
      return;
    }
    const imageUrl = createMode === "steam" ? selectedSteamItem.iconUrl || "" : createFields.imageUrl.value.trim();
    if (imageUrl && !/^https:\/\/.+/.test(imageUrl)) {
      setCreateStatus("admin.imageInvalid", "error");
      createFields.imageUrl.focus();
      return;
    }
    const now = Date.now();
    const data = {
      name,
      game: createFields.game.value,
      category: createFields.category.value,
      description: createFields.description.value.trim(),
      price: price.value,
      stock: stock.value,
      tags: createTags.getTags(),
      imageUrl,
      source: createMode === "steam" ? "steam" : "custom",
      steam: createMode === "steam" ? {
        marketHashName: selectedSteamItem.marketHashName,
        assetIds: selectedSteamItem.assetIds.slice(0, 50),
        type: selectedSteamItem.type
      } : null,
      listed: createFields.listed.checked,
      createdAt: now,
      updatedAt: now
    };
    createSubmit.disabled = true;
    setCreateStatus("admin.createSaving", "info");
    const outcome = await trackSave(() => db().collection("listings").add(data));
    createSubmit.disabled = false;
    if (outcome === true) {
      failedSaves = 0;
      setCreateStatus("admin.createSuccess", "success", { name });
      resetCreateForm();
    } else {
      failedSaves += 1;
      setCreateStatus("admin.createError", "error", { message: outcome?.message || "unknown" });
    }
    updateSaveIndicator();
  });

  // ---------- Steam import ----------

  function steamErrorMessage(code, status) {
    const keys = {
      inventory_unavailable: "shop.inventoryUnavailable",
      steam_unavailable: "shop.steamUnavailable",
      steam_rate_limited: "shop.steamUnavailable",
      invalid_steam_response: "shop.invalidSteamResponse",
      origin_not_allowed: "shop.corsNotAllowed"
    };
    return keys[code] ? text(keys[code]) : text("shop.workerHttpError", { status });
  }

  async function loadSteamInventory() {
    const endpoint = window.ELOSKIN2_STEAM_CONFIG?.inventoryEndpoint;
    if (!endpoint) {
      steamLoadState = "error";
      steamStatus.textContent = text("admin.steamNotConfigured");
      return;
    }
    steamLoadState = "loading";
    steamStatus.textContent = text("admin.steamLoading");
    steamGrid.replaceChildren();
    try {
      const response = await fetch(endpoint);
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(text("shop.invalidWorkerResponse"));
      }
      if (!response.ok) throw new Error(steamErrorMessage(data?.error, response.status));
      if (!Array.isArray(data.items)) throw new Error(text("shop.missingItems"));
      const grouped = new Map();
      for (const item of data.items) {
        const key = item.marketHashName || item.name;
        const entry = grouped.get(key);
        if (entry) {
          entry.count += Number(item.amount) || 1;
          entry.assetIds.push(String(item.assetId));
        } else {
          grouped.set(key, {
            key,
            name: String(item.name || key),
            marketHashName: String(item.marketHashName || ""),
            type: String(item.type || ""),
            iconUrl: /^https:\/\//.test(item.iconUrl || "") ? item.iconUrl : "",
            count: Number(item.amount) || 1,
            assetIds: [String(item.assetId)]
          });
        }
      }
      steamItems = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      steamLoadState = "loaded";
      renderSteamGrid();
    } catch (error) {
      steamLoadState = "error";
      steamStatus.textContent = error instanceof TypeError ? text("shop.workerUnavailable") : error.message;
    }
  }

  function listedMarketNames() {
    return new Set(listings.filter((listing) => listing.source === "steam" && listing.steam?.marketHashName)
      .map((listing) => listing.steam.marketHashName));
  }

  function renderSteamGrid() {
    if (steamLoadState !== "loaded") return;
    const term = steamSearch.value.trim().toLocaleLowerCase("zh-Hant");
    const listed = listedMarketNames();
    const visible = steamItems.filter((item) => !term
      || `${item.name} ${item.marketHashName} ${item.type}`.toLocaleLowerCase("zh-Hant").includes(term));
    steamStatus.textContent = text("admin.steamLoaded", { count: visible.length });
    const fragment = document.createDocumentFragment();
    for (const item of visible) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-steam-item";
      button.dataset.steamKey = item.key;
      button.classList.toggle("is-selected", selectedSteamItem?.key === item.key);
      const art = artElement(item.iconUrl, "CS2");
      const name = document.createElement("strong");
      name.textContent = item.name;
      name.title = item.name;
      const meta = document.createElement("span");
      meta.textContent = [item.type, text("admin.steamCount", { count: item.count })].filter(Boolean).join(" · ");
      button.append(art, name, meta);
      if (listed.has(item.marketHashName)) {
        const badge = document.createElement("span");
        badge.className = "admin-steam-badge";
        badge.textContent = text("admin.steamAlreadyListed");
        button.append(badge);
      }
      fragment.append(button);
    }
    steamGrid.replaceChildren(fragment);
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = text("admin.steamEmpty");
      steamGrid.append(empty);
    }
  }

  steamGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-steam-key]");
    if (!button) return;
    const item = steamItems.find((entry) => entry.key === button.dataset.steamKey);
    if (!item) return;
    selectedSteamItem = item;
    steamGrid.querySelectorAll(".admin-steam-item").forEach((element) => {
      element.classList.toggle("is-selected", element === button);
    });
    createFields.name.value = item.name;
    createFields.game.value = "CS2";
    createFields.category.value = detectCategoryKey(item.name, item.type);
    createFields.description.value = item.type;
    createFields.stock.value = String(item.count);
    setCreateStatus("");
    updateCreatePreview();
    createFields.price.focus();
  });

  steamSearch.addEventListener("input", renderSteamGrid);
  $("#admin-steam-reload").addEventListener("click", loadSteamInventory);

  // ---------- FAQ ----------

  function defaultFaq() {
    return Object.values(copy.home.faqItems).map(({ question, answer }) => ({ question, answer }));
  }

  function faqBusy() {
    return editingInside(faqList) || Boolean(faqTimer) || faqSaving;
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
    button.className = "admin-icon-button";
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
      if (!editable) card.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = true; });
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
      if (editingInside(faqList) || !faqTimer) return;
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
      if (!armConfirm(button, "admin.faqDeleteConfirm", "admin.faqDelete")) return;
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
    if (canEdit()) startListingsListener();
    else stopListingsListener();
    queueProductRender();
    if (!faqBusy()) loadFaqFromSite(true);
    createSubmit.disabled = !canEdit();
    updateCreatePreview();
    updateSaveIndicator();
  }

  window.addEventListener("eloauthchange", (event) => {
    const detail = event.detail || {};
    const changedUser = detail.user?.uid !== currentUser?.uid;
    currentUser = detail.user || null;
    isAdmin = Boolean(detail.isAdmin);
    emailVerified = Boolean(detail.emailVerified);
    if (changedUser) {
      failedSaves = 0;
      stopListingsListener();
    }
    if (!isAdmin) return;
    refreshAll();
  });

  window.addEventListener("elofirebaseready", () => { if (isAdmin) refreshAll(); });
  window.addEventListener("faqchange", () => { if (isAdmin) loadFaqFromSite(); });

  window.addEventListener("beforeunload", (event) => {
    if (!isAdmin || pendingCount() === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });

  resetCreateForm();
})();

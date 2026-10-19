const copy = window.ELOSKIN2_TEXT;
const t = window.eloText;
const products = [];
window.eloProductCatalog = products;
window.eloHiddenProductIds = new Set();
window.eloProductVisibilityId = (product) => product.source === "steam"
  ? `steam:${product.marketHashName}`
  : product.id;
function isProductPublished(product) {
  return !window.eloHiddenProductIds.has(window.eloProductVisibilityId(product));
}
const categoryKeys = ["item", "case", "weapon", "competitor", "rifle", "sniper", "pistol", "knife", "gloves", "rivals"];
const categories = [copy.categories.allItems, ...categoryKeys.map((key) => copy.categories[key])];
const games = [
  { id: "all", label: copy.games.all },
  { id: "CS2", label: copy.games.cs2 },
  { id: "ROBLOX RIVALS", label: copy.games.rivals }
];
const state = { category: copy.categories.allItems, game: "all", search: "", sort: "featured", cart: new Map(), favorites: new Set() };
const favoriteCounts = new Map();
const favoriteStatusChecks = new Set();
let homeMarketMode = "popular";
const steamConfig = window.ELOSKIN2_STEAM_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const productGrid = $("#product-grid");
const categoryFilters = $("#category-filters");
const gameFilters = $("#game-filters");
const cartModal = $("#cart-modal");
let toastTimer;

function renderFilters() {
  categoryFilters.innerHTML = categories.map((category) =>
    `<button class="filter-button${state.category === category ? " active" : ""}" type="button" data-category="${escapeHtml(category)}" aria-pressed="${state.category === category}">${escapeHtml(category)}</button>`
  ).join("");
  gameFilters.innerHTML = games.map((game) =>
    `<button class="game-button${state.game === game.id ? " active" : ""}" type="button" data-game="${escapeHtml(game.id)}" aria-pressed="${state.game === game.id}">${escapeHtml(game.label)}</button>`
  ).join("");
}

function visibleProducts() {
  const term = state.search.trim().toLocaleLowerCase("zh-Hant");
  const visible = products.filter((product) => {
    if (!isProductPublished(product)) return false;
    const matchesCategory = state.category === copy.categories.allItems || product.category === state.category || product.kind === state.category;
    const matchesGame = state.game === "all" || product.game === state.game;
    const matchesSearch = !term || [product.name, product.game, product.category, product.description, product.wear].some((value) => value.toLocaleLowerCase("zh-Hant").includes(term));
    return matchesCategory && matchesGame && matchesSearch;
  });
  const sorters = {
    featured: (a, b) => products.indexOf(a) - products.indexOf(b),
    "price-ascending": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    "price-descending": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    "stock-descending": (a, b) => b.stock - a.stock,
    "name-ascending": (a, b) => a.name.localeCompare(b.name, "zh-Hant")
  };
  const sorter = sorters[state.sort] || sorters.featured;
  return visible.sort(sorter);
}

function renderProducts() {
  const visible = visibleProducts();
  productGrid.innerHTML = visible.map(productCardMarkup).join("");
  $("#product-total").textContent = visible.length;
  $("#empty-state").hidden = visible.length > 0;
  productGrid.hidden = visible.length === 0;
}

function renderHomeCategories() {
  const categoryArt = copy.categories.art;
  $("#home-categories").innerHTML = categories.slice(1).map((category, index) => {
    const categoryKey = categoryKeys[index];
    const gameLabel = ["competitor", "rivals"].includes(categoryKey) ? copy.games.rivals
      : categoryKey === "item" ? copy.games.combined : copy.games.collection;
    return `
      <button class="category-tile" type="button" data-home-category="${escapeHtml(category)}">
        <span class="category-symbol">${escapeHtml(categoryArt[categoryKey] || "")}</span>
        <span><strong>${escapeHtml(category)}</strong><small>${escapeHtml(gameLabel)}</small></span>
        <span class="category-arrow" aria-hidden="true"><img src="assets/icon_new/arrow_forward_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png" alt=""></span>
      </button>`;
  }).join("");
}

function productArtwork(product) {
  const silhouette = {
    rifle: `
      <path d="M44 81h54l22-12h123l27 8h102v11H274l-18 10h-77l-16 27h-22l8-29h-30l-21-8H44z" fill="#56636d"/>
      <path d="M53 80h39v18H53l-13-8z" fill="#313c45"/>
      <path d="M120 73h116v18H120z" fill="${product.accent}"/>
      <path d="M237 76h137v9H237z" fill="#8e9ba2"/>
      <path d="M184 97h31l-7 40h-17z" fill="#39454d"/>
      <path d="M155 66h47V58h10v8h25v5h-82z" fill="#7e8a91"/>
      <path d="M131 76h87M246 80h99M79 87h17M190 105v25" fill="none" stroke="#c0c8cc" stroke-opacity=".55" stroke-width="2"/>
      <path d="M130 77h63" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>`,
    sniper: `
      <path d="M26 82h75l15-11h143l18 8h112v10H270l-15 11h-64l-15 25h-19l7-28h-35l-20-8H26z" fill="#65747d"/>
      <path d="M117 74h135v17H117z" fill="${product.accent}"/>
      <path d="M256 78h132v7H256z" fill="#aeb9bf"/>
      <path d="M173 62h71v8h-71zM190 53h36v9h-36z" fill="#77858d"/>
      <path d="M198 98h31l-7 39h-17zM65 81h32v15H65z" fill="#39464f"/>
      <path d="M131 78h82M274 81h88M194 58h27" fill="none" stroke="#eff5f7" stroke-opacity=".6" stroke-width="2"/>`,
    pistol: `
      <path d="M92 68h181l18 10h34v10h-61l-8 14h-40l-7 31h-22l4-34h-39l-18-15H92z" fill="#66747d"/>
      <path d="M105 70h134v12H105z" fill="${product.accent}"/>
      <path d="M272 77h55v8h-55zM181 101h36l-7 27h-18z" fill="#39464f"/>
      <path d="M122 73h85M250 80h54M193 106v15" fill="none" stroke="#f1f5f6" stroke-opacity=".55" stroke-width="2"/>
      <circle cx="253" cy="75" r="3" fill="#c5d0d4"/>`,
    knife: `
      <path d="M56 115 249 50q47-17 91-3-34 15-71 38L116 143z" fill="${product.accent}"/>
      <path d="m56 115 60 28 28-22-43-19z" fill="#53616b"/>
      <path d="m144 116 17 8 12-7-18-12zM178 102l18 8 11-7-18-12z" fill="#aab4ba" fill-opacity=".8"/>
      <path d="m74 113 40 18M253 53q36-13 70-8" fill="none" stroke="#eef4f6" stroke-opacity=".7" stroke-width="3"/>
      <circle cx="128" cy="126" r="4" fill="#1b242b"/>`,
    gloves: `
      <path d="M113 132q-17-8-20-28l-9-37q-2-11 7-13 8-1 11 10l8 20-7-40q-1-11 8-12 9 0 11 11l7 39-1-49q0-11 9-11t10 12l2 49 4-39q1-10 10-9 9 1 8 12l-5 47q-2 26-20 39z" fill="#43555e"/>
      <path d="M277 132q-17-8-20-28l-9-37q-2-11 7-13 8-1 11 10l8 20-7-40q-1-11 8-12 9 0 11 11l7 39-1-49q0-11 9-11t10 12l2 49 4-39q1-10 10-9 9 1 8 12l-5 47q-2 26-20 39z" fill="${product.accent}"/>
      <path d="m107 83 54-7m-48 19 51-8m111-4 53-7m-48 19 51-8" fill="none" stroke="#d3dcdf" stroke-opacity=".7" stroke-width="4"/>
      <path d="M119 121q17 12 36 2m124-2q17 12 36 2" fill="none" stroke="#10171b" stroke-opacity=".8" stroke-width="4"/>`,
    rivals: `
      <path d="m81 111 109-69 40 15-86 90-47-12z" fill="${product.accent}"/>
      <path d="m190 42 25-19 44 16-29 18z" fill="#9aa8b0"/>
      <path d="m145 122 42-30 25 11-35 39z" fill="#36444d"/>
      <path d="m93 107 93-57m-38 69 58-52" fill="none" stroke="#eef5f7" stroke-opacity=".65" stroke-width="3"/>
      <circle cx="184" cy="74" r="8" fill="#182127" stroke="#eaf3f5" stroke-opacity=".65" stroke-width="3"/>`,
    case: `
      <path d="m112 51 99-24 99 24-99 27z" fill="${product.accent}"/>
      <path d="m112 51v82l99 30V78z" fill="#52616d"/>
      <path d="m211 78 99-27v82l-99 30z" fill="#34434e"/>
      <path d="m146 61 65-16 65 16-65 18z" fill="#1d2a32" fill-opacity=".8"/>
      <path d="M197 69h28v30h-28zM188 107h46v8h-46z" fill="#d4e1e5"/>
      <path d="m127 60 72 22v62m98-78-75 23v62" fill="none" stroke="#d2dfe4" stroke-opacity=".5" stroke-width="3"/>`,
    competitor: `
      <path d="m210 25 105 38v58q-28 43-105 67-77-24-105-67V63z" fill="#425c78"/>
      <path d="m210 40 88 32v46q-25 34-88 55-63-21-88-55V72z" fill="${product.accent}"/>
      <circle cx="180" cy="91" r="20" fill="#263c54"/>
      <circle cx="240" cy="91" r="20" fill="#e2edf5"/>
      <path d="M143 143q4-36 37-36t37 36m-7 0q4-36 37-36t37 36" fill="none" stroke="#1e354d" stroke-width="13"/>
      <path d="m196 111 14 14 15-14" fill="none" stroke="#fff" stroke-width="5"/>`
  }[product.art];
  if (!silhouette) return `<span class="product-art-placeholder" aria-hidden="true">${copy.games.cs2}</span>`;
  return `<svg class="product-art" viewBox="0 0 420 180" role="img" aria-label="${escapeHtml(t("product.artAlt", { name: product.name }))}" focusable="false">${silhouette}</svg>`;
}

function productCardMarkup(product) {
  const favoriteKey = productFavoriteKey(product);
  const favorite = state.favorites.has(favoriteKey);
  const favoriteCount = favoriteCounts.get(favoriteDocumentId(product)) || 0;
  const safeName = escapeHtml(product.name);
  const favoriteIcon = favorite
    ? "heart_minus_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png"
    : "heart_plus_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png";
  const priced = Number.isFinite(product.price) && product.price > 0;
  const artwork = product.iconUrl
    ? `<img class="product-art steam-product-art" src="${escapeHtml(product.iconUrl)}" alt="${safeName}" loading="lazy">`
    : productArtwork(product);
  const stockLabel = product.source === "steam" || product.wear === copy.product.notApplicable
    ? escapeHtml(t("product.stock", { amount: product.stock }))
    : escapeHtml(t("product.float", { wear: product.wear }));
  const favoriteLabel = favorite ? t("product.favoriteRemove") : t("product.favoriteAdd");
  const addLabel = priced && product.stock > 0
    ? t("product.addToCart", { name: product.name })
    : !priced ? t("product.unpriced", { name: product.name }) : t("product.outOfStock", { name: product.name });
  return `
    <article class="product-card">
      <div class="product-visual art-${product.art}">
        <button class="favorite-button${favorite ? " is-favorite" : ""}" type="button" data-favorite="${escapeHtml(product.id)}" aria-label="${escapeHtml(favoriteLabel)}：${safeName}" aria-pressed="${favorite}">
          <img src="assets/icon_new/${favoriteIcon}" alt="" aria-hidden="true">
        </button>
        ${artwork}
      </div>
      <div class="product-info">
        <h3 title="${safeName}">${safeName}</h3>
        <div class="product-description">${escapeHtml(product.description)}${product.wear === copy.product.notApplicable ? "" : ` <span>／ ${escapeHtml(product.wear)}</span>`}</div>
        <div class="product-favorite-count">${escapeHtml(t("home.marketFavoriteCount", { count: favoriteCount }))}</div>
        <div class="product-bottom">
          <div class="product-price">${priced ? `<span class="currency-symbol">${escapeHtml(t("product.currency"))}</span>${product.price.toLocaleString()}` : `<span class="unpriced-label">${escapeHtml(t("product.noPrice"))}</span>`}</div>
          <div class="product-stock">${product.stock === 0 ? escapeHtml(t("product.unavailable")) : stockLabel}</div>
          <button class="add-button" type="button" data-add="${escapeHtml(product.id)}" aria-label="${escapeHtml(addLabel)}" ${product.stock === 0 || !priced ? "disabled" : ""}>
            <img src="assets/icon_new/add_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png" alt="" aria-hidden="true">
          </button>
        </div>
      </div>
    </article>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function productFavoriteKey(product) {
  return product.source === "steam" ? `steam:${product.marketHashName}` : product.id;
}

function favoriteDocumentId(product) {
  return encodeURIComponent(productFavoriteKey(product));
}

function renderHomeProducts() {
  const uniqueProducts = [...new Map(products
    .filter(isProductPublished)
    .map((product) => [productFavoriteKey(product), product])).values()];
  const comparePrice = (a, b, direction) => {
    const aPriced = Number.isFinite(a.price);
    const bPriced = Number.isFinite(b.price);
    if (aPriced !== bPriced) return aPriced ? -1 : 1;
    return aPriced ? direction * (a.price - b.price) : 0;
  };
  const sorters = {
    popular: (a, b) => (favoriteCounts.get(favoriteDocumentId(b)) || 0) - (favoriteCounts.get(favoriteDocumentId(a)) || 0),
    expensive: (a, b) => comparePrice(a, b, -1),
    cheap: (a, b) => comparePrice(a, b, 1)
  };
  const sorter = sorters[homeMarketMode] || sorters.popular;
  const featured = uniqueProducts.sort((a, b) => sorter(a, b) || a.name.localeCompare(b.name, "zh-Hant")).slice(0, 3);
  $("#featured-grid").innerHTML = featured.map(productCardMarkup).join("");
  $("#featured-grid").hidden = featured.length === 0;
  $("#home-market-status").textContent = featured.length
    ? homeMarketMode === "popular" ? "" : t("home.marketUnpriced")
    : t("home.marketEmpty");
  if (typeof window.eloGetProductFavorite === "function") {
    for (const product of featured) {
      const key = productFavoriteKey(product);
      if (favoriteStatusChecks.has(key)) continue;
      favoriteStatusChecks.add(key);
      window.eloGetProductFavorite(product).then((isFavorite) => {
        if (isFavorite) state.favorites.add(key);
        else state.favorites.delete(key);
        renderProducts();
        renderHomeProducts();
      }).catch(() => favoriteStatusChecks.delete(key));
    }
  }
}

function renderCart() {
  const entries = [...state.cart.entries()];
  const count = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  const total = entries.reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + (product ? product.price * quantity : 0);
  }, 0);
  $("#cart-count").textContent = count;
  $("#cart-count").hidden = count === 0;
  $("#cart-total").textContent = total.toLocaleString();
  $("#cart-items").innerHTML = entries.map(([id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return `<div class="cart-row">
      <div class="cart-row-visual">${escapeHtml(product.label)}</div>
      <div class="cart-row-info"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.game === "CS2" ? copy.games.cs2 : copy.games.rivals)}${product.wear === copy.product.notApplicable ? "" : ` · ${escapeHtml(product.wear)}`}</span></div>
      <strong class="cart-row-price">${product.price.toLocaleString()} ${escapeHtml(t("product.currency"))}</strong>
      <div class="quantity-control">
        <button type="button" data-quantity="${id}" data-change="-1" aria-label="${escapeHtml(t("cart.remove", { name: product.name }))}">-</button>
        <span>${quantity}</span>
        <button type="button" data-quantity="${id}" data-change="1" aria-label="${escapeHtml(t("cart.increase", { name: product.name }))}" ${quantity >= product.stock ? "disabled" : ""}>+</button>
      </div>
    </div>`;
  }).join("");
  $("#cart-empty").hidden = count > 0;
  $("#cart-items").hidden = count === 0;
  $("#checkout").disabled = count === 0;
}

function steamInventoryProduct(item) {
  const type = String(item.type || "");
  const categoryName = `${item.name} ${type}`.toLocaleLowerCase("zh-Hant");
  const category = /glove|手套/.test(categoryName) ? copy.categories.gloves
    : /knife|刀/.test(categoryName) ? copy.categories.knife
      : /sniper|狙擊/.test(categoryName) ? copy.categories.sniper
      : /rifle|步槍/.test(categoryName) ? copy.categories.rifle
        : /pistol|手槍/.test(categoryName) ? copy.categories.pistol
          : /case|container|箱/.test(categoryName) ? copy.categories.case
            : /agent|探員|競爭者/.test(categoryName) ? copy.categories.competitor : copy.categories.cs2Items;
  const isWeapon = /knife|weapon|rifle|sniper|pistol|smg|shotgun|machine gun|刀|武器|步槍|狙擊|手槍/.test(categoryName);
  const kind = category === copy.categories.case || category === copy.categories.competitor ? category : isWeapon ? copy.categories.weapon : copy.categories.item;
  const configuredPrice = steamConfig.ecPrices?.[item.marketHashName];
  const price = Number.isInteger(Number(configuredPrice)) && Number(configuredPrice) > 0 ? Number(configuredPrice) : null;
  return {
    id: `steam-${item.assetId}`,
    assetId: item.assetId,
    source: "steam",
    name: item.name,
    marketHashName: item.marketHashName,
    game: "CS2",
    category,
    kind,
    description: type || copy.shop.steamDescription,
    price,
    wear: copy.product.notApplicable,
    stock: item.amount,
    label: category.toUpperCase(),
    art: "steam",
    accent: "#74c9c0",
    iconUrl: item.iconUrl
  };
}

async function loadSteamInventory() {
  const status = $("#steam-inventory-status");
  const refreshButton = $("#refresh-steam-inventory");
  const homeStatus = $("#home-market-status");
  const endpoint = steamConfig.inventoryEndpoint;
  if (!endpoint) {
    status.textContent = t("shop.inventoryUnconfigured");
    homeStatus.textContent = t("home.marketUnavailable");
    return;
  }

  refreshButton.disabled = true;
  refreshButton.textContent = t("shop.refreshLoading");
  status.textContent = t("shop.inventoryLoading");
  homeStatus.textContent = t("home.marketLoading");
  try {
    const response = await fetch(endpoint);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(t("shop.invalidWorkerResponse"));
    }
    if (!response.ok) {
      const errors = {
        steam_rate_limited: t("shop.inventoryRateLimited"),
        inventory_unavailable: t("shop.inventoryUnavailable"),
        steam_unavailable: t("shop.steamUnavailable"),
        invalid_steam_response: t("shop.invalidSteamResponse"),
        origin_not_allowed: t("shop.corsNotAllowed")
      };
      throw new Error(errors[data.error] || t("shop.workerHttpError", { status: response.status }));
    }
    if (!Array.isArray(data.items)) throw new Error(t("shop.missingItems"));

    const liveProducts = data.items.map(steamInventoryProduct);
    products.splice(0, products.length, ...products.filter((product) => product.source !== "steam"), ...liveProducts);
    for (const [id, quantity] of state.cart) {
      const currentProduct = products.find((product) => product.id === id);
      if (!currentProduct || currentProduct.stock < quantity || !Number.isFinite(currentProduct.price)) state.cart.delete(id);
    }
    renderFilters();
    renderProducts();
    renderHomeProducts();
    renderCart();
    window.dispatchEvent(new Event("catalogproductschange"));

    const updatedAt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    const totalQuantity = Number(data.tradableQuantity) || 0;
    status.textContent = liveProducts.length
      ? t("shop.stockSynced", { types: liveProducts.length, amount: totalQuantity, time: updatedAt, truncated: data.truncated ? t("shop.inventoryTruncated") : "" })
      : t("shop.inventoryEmpty");
    if (!liveProducts.length) homeStatus.textContent = t("home.marketEmpty");
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? t("shop.workerUnavailable")
      : error instanceof Error ? error.message : t("shop.genericInventoryError");
    homeStatus.textContent = t("home.marketUnavailable");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = t("shop.inventoryRefresh");
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

function navigateTo(page, shouldScroll = true) {
  const validPages = ["home", "shop", "trade", "profile"];
  const destination = validPages.includes(page) ? page : "home";
  document.querySelectorAll("[data-page-view]").forEach((view) => {
    const active = view.dataset.pageView === destination;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-page-link]").forEach((link) => {
    const active = link.dataset.pageLink === destination;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (shouldScroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function navigateHomeAnchor(anchor) {
  if (!document.getElementById(anchor)) return;
  history.pushState(null, "", `#${anchor}`);
  navigateTo("home", false);
  document.getElementById(anchor).scrollIntoView({ behavior: "instant", block: "start" });
}

function showHomeAnchor(anchor) {
  if (!document.getElementById(anchor)) return;
  navigateTo("home", false);
  document.getElementById(anchor).scrollIntoView({ behavior: "instant", block: "start" });
}

document.querySelectorAll("[data-page-link]").forEach((link) => {
  link.addEventListener("click", () => navigateTo(link.dataset.pageLink));
});
document.querySelectorAll("[data-home-anchor]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    navigateHomeAnchor(link.dataset.homeAnchor || link.getAttribute("href").slice(1));
  });
});
document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => {
    history.pushState(null, "", "#profile");
    navigateTo(button.dataset.page);
  });
});
window.addEventListener("hashchange", () => {
  const destination = location.hash.slice(1);
  if (["guide", "safety", "marketplace"].includes(destination)) showHomeAnchor(destination);
  else navigateTo(destination);
});

categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderFilters();
  renderProducts();
});

gameFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-game]");
  if (!button) return;
  state.game = button.dataset.game;
  renderFilters();
  renderProducts();
});

$("#search").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderProducts();
});

$("#home-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.search = $("#home-search").value;
  $("#search").value = state.search;
  history.pushState(null, "", "#shop");
  navigateTo("shop");
  renderProducts();
});

$("#home-categories").addEventListener("click", (event) => {
  const button = event.target.closest("[data-home-category]");
  if (!button) return;
  state.category = button.dataset.homeCategory;
  if (state.category === copy.categories.item) state.game = "all";
  else if ([copy.categories.rivals, copy.categories.competitor].includes(state.category)) state.game = "ROBLOX RIVALS";
  else state.game = "CS2";
  renderFilters();
  history.pushState(null, "", "#shop");
  navigateTo("shop");
  renderProducts();
});

$("#sort-products").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderProducts();
});

document.querySelectorAll("[data-market-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    homeMarketMode = button.dataset.marketMode;
    document.querySelectorAll("[data-market-mode]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    renderHomeProducts();
  });
});

$("#home-more-products").addEventListener("click", () => {
  $("#search").value = "";
  state.search = "";
  history.pushState(null, "", "#shop");
  navigateTo("shop");
  renderProducts();
});

document.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const product = products.find((item) => item.id === favorite.dataset.favorite);
    if (!product) return;
    const key = productFavoriteKey(product);
    const shouldFavorite = !state.favorites.has(key);
    if (shouldFavorite) state.favorites.add(key);
    else state.favorites.delete(key);
    renderProducts();
    renderHomeProducts();
    showToast(shouldFavorite ? t("messages.favoriteAdded") : t("messages.favoriteRemoved"));
    const toggleFavorite = window.eloToggleProductFavorite;
    if (typeof toggleFavorite === "function") {
      toggleFavorite(product, shouldFavorite).then((result) => {
        if (result) {
          if (result.isFavorite) state.favorites.add(key);
          else state.favorites.delete(key);
          favoriteCounts.set(favoriteDocumentId(product), result.count);
          renderProducts();
          renderHomeProducts();
        }
      }).catch(() => {
        if (shouldFavorite) state.favorites.delete(key);
        else state.favorites.add(key);
        renderProducts();
        renderHomeProducts();
        showToast(t("home.marketUnavailable"));
      });
    }
    return;
  }

  const button = event.target.closest("[data-add]");
  if (!button) return;
  const id = button.dataset.add;
  const product = products.find((item) => item.id === id);
  if (!product || !isProductPublished(product) || product.stock === 0) {
    showToast(t("product.unavailable"));
    return;
  }
  if (!Number.isFinite(product.price)) {
    showToast(t("shop.missingPrice"));
    return;
  }
  if ((state.cart.get(id) || 0) >= product.stock) {
    showToast(t("shop.maxCartStock"));
    return;
  }
  state.cart.set(id, (state.cart.get(id) || 0) + 1);
  renderCart();
  showToast(t("messages.cartAdded"));
});

$("#trade-grid").addEventListener("click", (event) => {
  const offer = event.target.closest("[data-offer]");
  if (offer) {
    showToast(t("trade.proposalUnavailable"));
    return;
  }
});

window.addEventListener("catalogvisibilitychange", () => {
  for (const [id] of state.cart) {
    const product = products.find((item) => item.id === id);
    if (product && !isProductPublished(product)) state.cart.delete(id);
  }
  renderProducts();
  renderHomeProducts();
  renderCart();
});

window.addEventListener("favoritecountschanged", (event) => {
  favoriteCounts.clear();
  for (const [id, count] of Object.entries(event.detail || {})) favoriteCounts.set(id, count);
  renderProducts();
  renderHomeProducts();
});

document.querySelectorAll("[data-requires-auth]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!window.eloAuthUser) {
      history.pushState(null, "", "#profile");
      navigateTo("profile");
      window.showAuthMessage?.(t("trade.listingRequiresLogin"), "info");
      return;
    }
    showToast(t("trade.listingNotConnected"));
  });
});

$("#open-cart").addEventListener("click", () => {
  cartModal.hidden = false;
  $("#close-cart").focus();
});

$("#refresh-steam-inventory").addEventListener("click", loadSteamInventory);
const steamTradeLink = $("#steam-trade-link");
if (typeof steamConfig.tradeOfferUrl === "string" && steamConfig.tradeOfferUrl.startsWith("https://steamcommunity.com/tradeoffer/")) {
  steamTradeLink.href = steamConfig.tradeOfferUrl;
} else {
  steamTradeLink.hidden = true;
}

function closeCart() {
  cartModal.hidden = true;
  $("#open-cart").focus();
}

$("#close-cart").addEventListener("click", closeCart);
cartModal.addEventListener("click", (event) => {
  if (event.target === cartModal) closeCart();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !cartModal.hidden) closeCart();
});

$("#cart-items").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity]");
  if (!button) return;
  const id = button.dataset.quantity;
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const next = Math.min(product.stock, (state.cart.get(id) || 0) + Number(button.dataset.change));
  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, next);
  renderCart();
});

$("#checkout").addEventListener("click", () => {
  if (state.cart.size === 0) return;
  state.cart.clear();
  renderCart();
  closeCart();
  showToast(t("cart.demoOrderComplete"));
});

renderFilters();
renderHomeCategories();
renderProducts();
renderHomeProducts();
renderCart();
const initialDestination = location.hash.slice(1) || "home";
if (["guide", "safety", "marketplace"].includes(initialDestination)) showHomeAnchor(initialDestination);
else {
  navigateTo(initialDestination);
}
loadSteamInventory();

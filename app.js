const products = [
  { id: "rivals-blade", name: "Rivals | 星痕短刃", game: "ROBLOX RIVALS", category: "Rivals 道具", kind: "武器", description: "玩家刊登 · 近戰造型", price: 520, wear: "不適用", stock: 3, label: "RIVALS", art: "rivals", accent: "#77b8ff" },
  { id: "rivals-rifle", name: "Rivals | 霓虹脈衝", game: "ROBLOX RIVALS", category: "Rivals 道具", kind: "商品", description: "玩家刊登 · 遠程造型", price: 760, wear: "不適用", stock: 2, label: "RIVALS", art: "sniper", accent: "#b779ff" },
  { id: "rivals-gloves", name: "Rivals | 競技手套", game: "ROBLOX RIVALS", category: "Rivals 道具", kind: "商品", description: "玩家刊登 · 裝備造型", price: 390, wear: "不適用", stock: 0, label: "RIVALS", art: "gloves", accent: "#4edacb" },
  { id: "rivals-rival", name: "Rivals | 競技者組合", game: "ROBLOX RIVALS", category: "競爭者", kind: "競爭者", description: "玩家刊登 · 競技主題外觀", price: 980, wear: "不適用", stock: 2, label: "RIVALS", art: "competitor", accent: "#7caeff" }
];

const playerListings = [
  { id: "listing-ak", seller: "AK", name: "AK-47｜夜色行者", game: "CS2", category: "武器造型", wants: "1,200 EC", detail: "想換 Roblox Rivals 道具或 EC", tone: "tone-dark" },
  { id: "listing-roblox", seller: "M", name: "星光披風", game: "ROBLOX RIVALS", category: "角色配件", wants: "800 EC", detail: "接受 CS2 物品或 EC 交換", tone: "tone-silver" },
  { id: "listing-case", seller: "K", name: "午夜行動箱 × 3", game: "CS2", category: "收藏箱", wants: "交換同價值道具", detail: "可一起談，請提出你的條件", tone: "tone-soft" }
];
const categories = ["全部物品", "商品", "箱子", "武器", "競爭者", "步槍", "狙擊槍", "手槍", "刀具", "手套", "Rivals 道具"];
const games = ["全部遊戲", "CS2", "ROBLOX RIVALS"];
const state = { category: "全部物品", game: "全部遊戲", search: "", sort: "featured", cart: new Map(), favorites: new Set() };
let homeMarketMode = "featured";
const steamConfig = window.ELOSKIN2_STEAM_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const productGrid = $("#product-grid");
const categoryFilters = $("#category-filters");
const gameFilters = $("#game-filters");
const cartModal = $("#cart-modal");
let toastTimer;

function renderFilters() {
  categoryFilters.innerHTML = categories.map((category) =>
    `<button class="filter-button${state.category === category ? " active" : ""}" type="button" data-category="${category}" aria-pressed="${state.category === category}">${category}</button>`
  ).join("");
  gameFilters.innerHTML = games.map((game) =>
    `<button class="game-button${state.game === game ? " active" : ""}" type="button" data-game="${game}" aria-pressed="${state.game === game}">${game}</button>`
  ).join("");
}

function visibleProducts() {
  const term = state.search.trim().toLocaleLowerCase("zh-Hant");
  const visible = products.filter((product) => {
    const matchesCategory = state.category === "全部物品" || product.category === state.category || product.kind === state.category;
    const matchesGame = state.game === "全部遊戲" || product.game === state.game;
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
  const categoryArt = {
    商品: "ITEMS",
    箱子: "CASE",
    武器: "WEAPONS",
    競爭者: "RIVALS",
    步槍: "M4",
    狙擊槍: "AWP",
    手槍: "USP",
    刀具: "KNIFE",
    手套: "GLOVES",
    "Rivals 道具": "RIVALS"
  };
  $("#home-categories").innerHTML = categories.slice(1).map((category) => `
    <button class="category-tile" type="button" data-home-category="${category}">
      <span class="category-symbol">${categoryArt[category]}</span>
    <span><strong>${category}</strong><small>${["競爭者", "Rivals 道具"].includes(category) ? "ROBLOX RIVALS" : category === "商品" ? "CS2 · ROBLOX RIVALS" : "CS2 COLLECTION"}</small></span>
      <span class="category-arrow" aria-hidden="true"><img src="assets/icon/icon-external-link.png" alt=""></span>
    </button>`).join("");
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
  if (!silhouette) return `<span class="product-art-placeholder" aria-hidden="true">CS2</span>`;
  return `<svg class="product-art" viewBox="0 0 420 180" role="img" aria-label="${product.name} 商品示意圖" focusable="false">${silhouette}</svg>`;
}

function productCardMarkup(product) {
  const favorite = state.favorites.has(product.id);
  const safeName = escapeHtml(product.name);
  const priced = Number.isFinite(product.price) && product.price > 0;
  const artwork = product.iconUrl
    ? `<img class="product-art steam-product-art" src="${escapeHtml(product.iconUrl)}" alt="${safeName}" loading="lazy">`
    : productArtwork(product);
  const stockLabel = product.source === "steam" ? `庫存 ${product.stock}` : product.wear === "不適用" ? `庫存 ${product.stock}` : `FLOAT ${escapeHtml(product.wear)}`;
  return `
    <article class="product-card">
      <div class="product-visual art-${product.art}">
        <span class="visual-type">${escapeHtml(product.label)}</span>
        <button class="favorite-button${favorite ? " is-favorite" : ""}" type="button" data-favorite="${escapeHtml(product.id)}" aria-label="${favorite ? "取消收藏" : "加入收藏"}：${safeName}" aria-pressed="${favorite}">
          <img src="assets/icon/icon-heart.png" alt="" aria-hidden="true">
        </button>
        ${artwork}
      </div>
      <div class="product-info">
        <div class="product-meta"><span>${escapeHtml(product.game)}</span><span class="product-category">${escapeHtml(product.category)}</span></div>
        <h3 title="${safeName}">${safeName}</h3>
        <div class="product-description">${escapeHtml(product.description)}${product.wear === "不適用" ? "" : ` <span>／ ${escapeHtml(product.wear)}</span>`}</div>
        <div class="product-bottom">
          <div class="product-price">${priced ? `<span class="currency-symbol">EC</span>${product.price.toLocaleString()}` : `<span class="unpriced-label">需設定 EC 價格</span>`}</div>
          <div class="product-stock">${product.stock === 0 ? "暫時缺貨" : stockLabel}</div>
          <button class="add-button" type="button" data-add="${escapeHtml(product.id)}" aria-label="${priced && product.stock > 0 ? `將${safeName}加入購物車` : !priced ? `${safeName}尚未設定 EC 價格` : `${safeName}暫時缺貨`}" ${product.stock === 0 || !priced ? "disabled" : ""}>
            <img src="assets/icon/icon-add.png" alt="" aria-hidden="true">
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

function renderHomeProducts() {
  let featured = products.filter((product) => product.game === "CS2");
  if (homeMarketMode === "latest") featured = featured.slice().reverse();
  if (homeMarketMode === "budget") featured = featured.filter((product) => Number.isFinite(product.price) && product.price <= 1500);
  const sorters = {
    featured: (a, b) => products.indexOf(a) - products.indexOf(b),
    "price-ascending": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    "price-descending": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity)
  };
  featured.sort(sorters[state.sort] || sorters.featured);
  $("#featured-grid").innerHTML = featured.map(productCardMarkup).join("");
  const curated = products.filter((product) => product.game === "CS2").slice(0, 3);
  $("#curated-grid").innerHTML = (curated.length ? curated : products.slice(0, 3)).map(productCardMarkup).join("");
}

function renderPlayerListings() {
  $("#trade-grid").innerHTML = playerListings.map((listing) => `
    <article class="trade-card">
      <div class="trade-card-visual ${listing.tone}">
        <span class="trade-game">${listing.game} · ${listing.category}</span>
        <span class="trade-item-mark">${listing.game === "CS2" ? "CS" : "R"}</span>
        <span class="trade-availability"><i></i> 開放提案</span>
      </div>
      <div class="trade-card-content">
        <div class="seller-line"><span class="seller-avatar">${listing.seller}</span><span><small>刊登玩家</small><strong>${listing.seller === "AK" ? "AK Collector" : listing.seller === "M" ? "Moonlight" : "Kaito"}</strong></span><span class="seller-rating">信譽良好</span></div>
        <h2>${listing.name}</h2>
        <p>${listing.detail}</p>
        <div class="trade-card-bottom"><div><small>希望交易條件</small><strong>${listing.wants}</strong></div><button class="offer-button" type="button" data-offer="${listing.id}">提出交易</button></div>
      </div>
    </article>`).join("");
}

function renderCart() {
  const entries = [...state.cart.entries()];
  const count = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  const total = entries.reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + (product ? product.price * quantity : 0);
  }, 0);
  $("#cart-count").textContent = count;
  $("#cart-total").textContent = total.toLocaleString();
  $("#cart-items").innerHTML = entries.map(([id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return `<div class="cart-row">
      <div class="cart-row-visual">${product.label}</div>
      <div class="cart-row-info"><strong>${product.name}</strong><span>${product.game}${product.wear === "不適用" ? "" : ` · 磨損 ${product.wear}`}</span></div>
      <strong class="cart-row-price">${product.price.toLocaleString()} EC</strong>
      <div class="quantity-control">
        <button type="button" data-quantity="${id}" data-change="-1" aria-label="減少${product.name}數量">-</button>
        <span>${quantity}</span>
        <button type="button" data-quantity="${id}" data-change="1" aria-label="增加${product.name}數量" ${quantity >= product.stock ? "disabled" : ""}>+</button>
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
  const category = /glove|手套/.test(categoryName) ? "手套"
    : /knife|刀/.test(categoryName) ? "刀具"
      : /sniper|狙擊/.test(categoryName) ? "狙擊槍"
      : /rifle|步槍/.test(categoryName) ? "步槍"
        : /pistol|手槍/.test(categoryName) ? "手槍"
          : /case|container|箱/.test(categoryName) ? "箱子"
            : /agent|探員|競爭者/.test(categoryName) ? "競爭者" : "CS2 物品";
  const isWeapon = /knife|weapon|rifle|sniper|pistol|smg|shotgun|machine gun|刀|武器|步槍|狙擊|手槍/.test(categoryName);
  const kind = category === "箱子" || category === "競爭者" ? category : isWeapon ? "武器" : "商品";
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
    description: type || "Steam 可交易物品",
    price,
    wear: "不適用",
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
  const endpoint = steamConfig.inventoryEndpoint;
  if (!endpoint) {
    status.textContent = "尚未設定庫存代理網址。完成 Cloudflare Worker 部署並填入 steam-config.js 後即可讀取。";
    return;
  }

  refreshButton.disabled = true;
  refreshButton.textContent = "讀取中…";
  status.textContent = "正在讀取 Steam 可交易物品…";
  try {
    const response = await fetch(endpoint);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Steam 庫存服務回傳無法辨識的資料。");
    }
    if (!response.ok) {
      const errors = {
        steam_rate_limited: "Steam 暫時限制了庫存讀取，請稍後再試。",
        inventory_unavailable: "無法讀取物品庫；請確認 Steam 個人資料與物品庫設為公開。",
        steam_unavailable: "Steam 暫時無法提供物品庫，請稍後再試。",
        invalid_steam_response: "Steam 回傳的庫存資料格式無效。",
        origin_not_allowed: "此網站來源尚未加入 Cloudflare Worker 的 ALLOWED_ORIGINS 設定。"
      };
      throw new Error(errors[data.error] || `庫存代理讀取失敗（HTTP ${response.status}）。`);
    }
    if (!Array.isArray(data.items)) throw new Error("庫存服務缺少物品清單。");

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

    const updatedAt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    const totalQuantity = Number(data.tradableQuantity) || 0;
    status.textContent = liveProducts.length
      ? `同步完成：${liveProducts.length} 種可交易物品，共 ${totalQuantity} 件；更新時間 ${updatedAt}${data.truncated ? "（清單過長，僅顯示前 20,000 件）" : ""}。`
      : "目前沒有可交易的 CS2 物品。";
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? "無法連線到庫存代理；請確認 Worker 網址、部署狀態與 CORS 網域設定。"
      : error instanceof Error ? error.message : "讀取 Steam 物品庫失敗。";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "重新讀取庫存";
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
  if (state.category === "商品") state.game = "全部遊戲";
  else if (["Rivals 道具", "競爭者"].includes(state.category)) state.game = "ROBLOX RIVALS";
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

$("#home-sort").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderHomeProducts();
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

document.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = favorite.dataset.favorite;
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    renderProducts();
    renderHomeProducts();
    showToast(state.favorites.has(id) ? "已加入收藏" : "已從收藏移除");
    return;
  }

  const button = event.target.closest("[data-add]");
  if (!button) return;
  const id = button.dataset.add;
  const product = products.find((item) => item.id === id);
  if (!product || product.stock === 0) {
    showToast("這件商品目前沒有庫存。");
    return;
  }
  if (!Number.isFinite(product.price)) {
    showToast("此物品尚未設定 EC 價格。");
    return;
  }
  if ((state.cart.get(id) || 0) >= product.stock) {
    showToast("購物車數量已達目前庫存。");
    return;
  }
  state.cart.set(id, (state.cart.get(id) || 0) + 1);
  renderCart();
  showToast("已加入購物車");
});

$("#trade-grid").addEventListener("click", (event) => {
  const offer = event.target.closest("[data-offer]");
  if (offer) {
    showToast("交易提案功能尚未連接；目前不會送出真實提案。");
    return;
  }
});

document.querySelectorAll("[data-requires-auth]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!window.eloAuthUser) {
      history.pushState(null, "", "#profile");
      navigateTo("profile");
      window.showAuthMessage?.("登入或註冊後即可建立個人交易刊登。", "info");
      return;
    }
    showToast("刊登功能尚未連接資料庫，尚未建立真實刊登。");
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
  showToast("展示訂單已完成；沒有建立真實交易。");
});

renderFilters();
renderHomeCategories();
renderProducts();
renderHomeProducts();
renderPlayerListings();
renderCart();
const initialDestination = location.hash.slice(1) || "home";
if (["guide", "safety", "marketplace"].includes(initialDestination)) showHomeAnchor(initialDestination);
else {
  navigateTo(initialDestination);
}
loadSteamInventory();

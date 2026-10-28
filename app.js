const copy = window.ELOSKIN2_TEXT;
const t = window.eloText;
const products = [];
const demoProducts = [
  { id: "demo-ak47-rust", name: "AK-47 | 赤砂", game: "CS2", category: copy.categories.rifle, kind: copy.categories.weapon, description: "", price: 4260, stock: 3, art: "rifle", accent: "#c77955", wearCondition: "field-tested", rarityColor: "restricted", stattrak: false, hasStickers: true, hasCharm: false },
  { id: "demo-awp-frost", name: "AWP | 冬痕", game: "CS2", category: copy.categories.sniper, kind: copy.categories.weapon, description: "", price: 12800, stock: 1, art: "sniper", accent: "#86b9aa", wearCondition: "minimal-wear", rarityColor: "classified", stattrak: true, hasStickers: true, hasCharm: false },
  { id: "demo-knife-ember", name: "折刃刀 | 餘燼", game: "CS2", category: copy.categories.knife, kind: copy.categories.weapon, description: "", price: 9360, stock: 2, art: "knife", accent: "#d58b58", wearCondition: "factory-new", rarityColor: "covert", stattrak: false, hasStickers: false, hasCharm: true },
  { id: "demo-gloves-moss", name: "手套 | 苔色", game: "CS2", category: copy.categories.gloves, kind: copy.categories.item, description: "", price: 6450, stock: 2, art: "gloves", accent: "#88a968", wearCondition: "well-worn", rarityColor: "extraordinary", stattrak: false, hasStickers: false, hasCharm: false },
  { id: "demo-case-night", name: "夜行武器箱", game: "CS2", category: copy.categories.case, kind: copy.categories.case, description: "", price: 520, stock: 8, art: "case", accent: "#6b86a3", wearCondition: "not-applicable", rarityColor: "base-grade", stattrak: false, hasStickers: false, hasCharm: false }
].map((product) => ({
  ...product,
  tags: [],
  source: "demo",
  wear: copy.product.notApplicable,
  label: product.category.toUpperCase()
}));
let catalogLoaded = false;
window.eloProductCatalog = products;
window.eloProductVisibilityId = (product) => product.id;
function isProductPublished(product) {
  return product.listed !== false;
}
const LISTING_CATEGORY_ART = { rifle: "rifle", sniper: "sniper", pistol: "pistol", knife: "knife", gloves: "gloves", case: "case", competitor: "competitor", rivals: "rivals" };
const WEAPON_CATEGORY_KEYS = ["weapon", "rifle", "sniper", "pistol", "knife"];

const WEAR_BY_SUFFIX = {
  "factory new": "factory-new",
  "minimal wear": "minimal-wear",
  "field-tested": "field-tested",
  "well-worn": "well-worn",
  "battle-scarred": "battle-scarred"
};

function detectWear(marketHashName) {
  const match = /\(([^()]+)\)\s*$/.exec(marketHashName || "");
  return match ? WEAR_BY_SUFFIX[match[1].toLowerCase()] || "unknown" : "unknown";
}

function detectRarity(type) {
  const value = String(type || "");
  if (/消費|Consumer/i.test(value)) return "consumer";
  if (/工業|Industrial/i.test(value)) return "industrial";
  if (/軍規|Mil-Spec/i.test(value)) return "mil-spec";
  if (/受限|Restricted/i.test(value)) return "restricted";
  if (/機密|保密|Classified/i.test(value)) return "classified";
  if (/隱密|隱秘|Covert/i.test(value)) return "covert";
  if (/非凡|Extraordinary/i.test(value)) return "extraordinary";
  return "unknown";
}

function listingProduct(listing) {
  const key = typeof copy.categories[listing.category] === "string" ? listing.category : "item";
  const category = copy.categories[key];
  const kind = key === "case" || key === "competitor" ? category
    : WEAPON_CATEGORY_KEYS.includes(key) ? copy.categories.weapon : copy.categories.item;
  const name = String(listing.name || "");
  return {
    id: `listing-${listing.id}`,
    listingId: listing.id,
    source: "listing",
    listingSource: listing.source,
    listed: listing.listed !== false,
    name,
    game: listing.game === "ROBLOX RIVALS" ? "ROBLOX RIVALS" : "CS2",
    category,
    categoryKey: key,
    kind,
    description: String(listing.description || ""),
    price: Number.isInteger(listing.price) && listing.price >= 0 ? listing.price : null,
    stock: Number.isInteger(listing.stock) && listing.stock >= 0 ? listing.stock : 0,
    tags: Array.isArray(listing.tags) ? listing.tags.filter((tag) => typeof tag === "string") : [],
    wear: copy.product.notApplicable,
    wearCondition: detectWear(listing.steam?.marketHashName),
    rarityColor: detectRarity(listing.steam?.type || listing.description),
    stattrak: /stattrak/i.test(`${name} ${listing.steam?.marketHashName || ""}`),
    miniGame: listing.game === "ROBLOX RIVALS" ? "rivals" : "",
    hasStickers: false,
    hasCharm: false,
    label: category.toUpperCase(),
    art: LISTING_CATEGORY_ART[key] || "",
    accent: "#74c9c0",
    iconUrl: /^https:\/\//.test(listing.imageUrl || "") ? listing.imageUrl : "",
    marketHashName: listing.steam?.marketHashName || "",
    createdAt: Number(listing.createdAt) || 0
  };
}
const categoryKeys = ["item", "case", "weapon", "competitor", "rifle", "sniper", "pistol", "knife", "gloves", "rivals"];
const categories = [copy.categories.allItems, ...categoryKeys.map((key) => copy.categories[key])];
const games = [
  { id: "all", label: copy.games.all },
  { id: "CS2", label: copy.games.cs2 },
  { id: "ROBLOX RIVALS", label: copy.games.rivals }
];
const SHOP_GAME_FILTERS = { categories: [], wear: [], rarity: [], stattrak: [], stickers: [], charms: [], miniGame: [] };
const SHOP_FILTER_KEYS = {
  "shop-type-filter": "categories",
  "shop-tag-filter": "tags",
  "shop-wear-filter": "wear",
  "shop-rarity-filter": "rarity",
  "shop-stattrak-filter": "stattrak",
  "shop-stickers-filter": "stickers",
  "shop-charms-filter": "charms",
  "shop-minigame-filter": "miniGame"
};
const state = { ...structuredClone(SHOP_GAME_FILTERS), tags: [], game: "all", search: "", sort: "featured", openFilter: "", cart: new Map(), favorites: new Set() };
const tradeState = {
  category: [],
  game: "CS2",
  search: "",
  sort: "featured",
  offer: [],
  receive: [],
  minPrice: 0,
  maxPrice: 50000,
  wear: [],
  rarity: [],
  stattrak: [],
  stickers: [],
  charms: [],
  miniGame: [],
  openFilter: ""
};
const favoriteCounts = new Map();
const favoriteStatusChecks = new Set();
let homeMarketMode = "popular";
const steamConfig = window.ELOSKIN2_STEAM_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const productGrid = $("#product-grid");
const shopFilters = $("#shop-filters");
const cartModal = $("#cart-modal");
let toastTimer;

function dropdownFilterMarkup({ id, label, selected, options, multiple = true, emptyLabel, openFilter, note = "" }) {
  const selectedLabels = options.filter(({ value }) => selected.includes(value)).map((option) => option.label);
  const summary = selectedLabels.length
    ? `${selectedLabels.slice(0, 2).join("、")}${selectedLabels.length > 2 ? ` +${selectedLabels.length - 2}` : ""}`
    : emptyLabel;
  const expanded = openFilter === id;
  const optionsMarkup = options.map(({ value, label: optionLabel }) => `
    <label class="trade-filter-option">
      <input type="${multiple ? "checkbox" : "radio"}" ${multiple ? "" : `name="${id}"`} value="${escapeHtml(value)}" data-filter-value="${escapeHtml(value)}"${selected.includes(value) ? " checked" : ""}>
      <span class="trade-filter-check" aria-hidden="true"></span>
      <span>${escapeHtml(optionLabel)}</span>
    </label>`).join("");
  return `
    <div class="trade-filter${expanded ? " is-open" : ""}" data-shop-filter="${id}">
      <button class="trade-filter-toggle" type="button" data-shop-filter-toggle="${id}" aria-expanded="${expanded}" aria-controls="${id}-options">
        <span class="trade-filter-label">${escapeHtml(label)}</span>
        <span class="trade-filter-summary">${escapeHtml(summary)}</span>
        <span class="trade-filter-chevron" aria-hidden="true"></span>
      </button>
      <div class="trade-filter-panel" id="${id}-options" aria-hidden="${!expanded}"${expanded ? "" : " inert"}>
        <div class="trade-filter-panel-inner">
          <div class="trade-filter-options" role="${multiple ? "group" : "radiogroup"}" aria-label="${escapeHtml(label)}">
            ${optionsMarkup || `<p class="trade-filter-note">${escapeHtml(note)}</p>`}
          </div>
        </div>
      </div>
    </div>`;
}

function availableTags() {
  return [...new Set(products.flatMap((product) => product.tags || []))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function renderFilters() {
  const sortOptions = [
    { value: "featured", label: copy.shop.sortRecommended },
    { value: "price-ascending", label: copy.shop.sortPriceLow },
    { value: "price-descending", label: copy.shop.sortPriceHigh },
    { value: "stock-descending", label: copy.shop.sortStock },
    { value: "name-ascending", label: copy.shop.sortName }
  ];
  const yesNo = [{ value: "yes", label: copy.trade.has }, { value: "no", label: copy.trade.hasNot }];
  const filter = (id, label, key, options, extra = {}) => dropdownFilterMarkup({
    id, label, selected: state[key], options, emptyLabel: copy.trade.any, openFilter: state.openFilter, ...extra
  });
  const typeKeys = state.game === "CS2" ? ["weapon", "rifle", "sniper", "pistol", "knife", "gloves", "case", "item"] : categoryKeys;
  state.tags = state.tags.filter((tag) => availableTags().includes(tag));
  const parts = [
    dropdownFilterMarkup({ id: "shop-game-filter", label: copy.shop.filterGame, selected: [state.game], multiple: false,
      options: games.map((game) => ({ value: game.id, label: game.label })), emptyLabel: copy.games.all, openFilter: state.openFilter })
  ];
  if (state.game === "ROBLOX RIVALS") {
    parts.push(filter("shop-minigame-filter", copy.trade.miniGame, "miniGame", [{ value: "rivals", label: copy.trade.rivals }]));
  } else {
    parts.push(filter("shop-type-filter", copy.shop.filterType, "categories",
      typeKeys.map((key) => ({ value: copy.categories[key], label: copy.categories[key] })), { emptyLabel: copy.trade.allTypes }));
  }
  if (state.game === "CS2") {
    parts.push(
      filter("shop-wear-filter", copy.trade.wear, "wear", [
        { value: "factory-new", label: copy.trade.wearFactoryNew },
        { value: "minimal-wear", label: copy.trade.wearMinimal },
        { value: "field-tested", label: copy.trade.wearFieldTested },
        { value: "well-worn", label: copy.trade.wearWellWorn },
        { value: "battle-scarred", label: copy.trade.wearBattleScarred }
      ], { emptyLabel: copy.trade.allWear }),
      filter("shop-rarity-filter", copy.trade.rarity, "rarity", [
        { value: "consumer", label: copy.trade.rarityConsumer },
        { value: "industrial", label: copy.trade.rarityIndustrial },
        { value: "mil-spec", label: copy.trade.rarityMilSpec },
        { value: "restricted", label: copy.trade.rarityRestricted },
        { value: "classified", label: copy.trade.rarityClassified },
        { value: "covert", label: copy.trade.rarityCovert },
        { value: "extraordinary", label: copy.trade.rarityExtraordinary }
      ], { emptyLabel: copy.trade.allRarity }),
      filter("shop-stattrak-filter", copy.trade.stattrak, "stattrak", yesNo),
      filter("shop-stickers-filter", copy.trade.stickers, "stickers", yesNo),
      filter("shop-charms-filter", copy.trade.charms, "charms", yesNo)
    );
  }
  parts.push(
    dropdownFilterMarkup({ id: "shop-tag-filter", label: copy.shop.filterTags, selected: state.tags,
      options: availableTags().map((tag) => ({ value: tag, label: tag })), emptyLabel: copy.shop.anyTag, openFilter: state.openFilter, note: copy.shop.noTags }),
    dropdownFilterMarkup({ id: "shop-sort-filter", label: copy.shop.sortLabel, selected: [state.sort], multiple: false,
      options: sortOptions, emptyLabel: copy.shop.sortRecommended, openFilter: state.openFilter }),
    `<button class="trade-reset-filters shop-reset-filters" type="button" data-shop-reset>${escapeHtml(copy.trade.resetFilters)}</button>`
  );
  shopFilters.innerHTML = parts.join("");
}

function tradeFilterMarkup(id, labelKey, selectedValues, options, { multiple = true, emptyLabel } = {}) {
  const selectedLabels = options
    .filter(({ value }) => selectedValues.includes(value))
    .map(({ label }) => label);
  const summary = selectedLabels.length
    ? `${selectedLabels.slice(0, 2).join("、")}${selectedLabels.length > 2 ? ` +${selectedLabels.length - 2}` : ""}`
    : emptyLabel;
  const inputType = multiple ? "checkbox" : "radio";
  const inputName = multiple ? "" : `name="trade-filter-${id}"`;
  const optionsMarkup = options.map(({ value, label }) => `
    <label class="trade-filter-option">
      <input type="${inputType}" ${inputName} value="${escapeHtml(value)}" data-trade-filter-value="${escapeHtml(value)}"${selectedValues.includes(value) ? " checked" : ""}>
      <span class="trade-filter-check" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
    </label>`).join("");
  const expanded = tradeState.openFilter === id;
  return `
    <div class="trade-filter${expanded ? " is-open" : ""}" id="${id}" data-trade-filter="${id}">
      <button class="trade-filter-toggle" type="button" data-filter-toggle="${id}" aria-expanded="${expanded}" aria-controls="${id}-options">
        <span class="trade-filter-label">${escapeHtml(copy.trade[labelKey])}</span>
        <span class="trade-filter-summary">${escapeHtml(summary)}</span>
        <span class="trade-filter-chevron" aria-hidden="true"></span>
      </button>
      <div class="trade-filter-panel" id="${id}-options" aria-hidden="${!expanded}"${expanded ? "" : " inert"}>
        <div class="trade-filter-panel-inner">
          <div class="trade-filter-options" role="${multiple ? "group" : "radiogroup"}" aria-label="${escapeHtml(copy.trade[labelKey])}">
            ${optionsMarkup}
          </div>
        </div>
      </div>
    </div>`;
}

function renderTradeFilters() {
  const gameOptions = [
    { value: "CS2", label: copy.games.cs2 },
    { value: "ROBLOX RIVALS", label: copy.trade.roblox }
  ];
  const filters = [
    tradeFilterMarkup("trade-game-filter", "game", [tradeState.game], gameOptions, {
      multiple: false,
      emptyLabel: copy.trade.chooseGame
    })
  ];
  if (tradeState.game === "CS2") {
    filters.push(
      tradeFilterMarkup("trade-type-filter", "itemType", tradeState.category, [
        ...[
          copy.categories.weapon,
          copy.categories.case,
          copy.categories.rifle,
          copy.categories.sniper,
          copy.categories.pistol,
          copy.categories.knife,
          copy.categories.gloves,
          copy.categories.competitor
        ].map((category) => ({ value: category, label: category }))
      ], { emptyLabel: copy.trade.allTypes }),
      tradeFilterMarkup("trade-wear-filter", "wear", tradeState.wear, [
        { value: "factory-new", label: copy.trade.wearFactoryNew },
        { value: "minimal-wear", label: copy.trade.wearMinimal },
        { value: "field-tested", label: copy.trade.wearFieldTested },
        { value: "well-worn", label: copy.trade.wearWellWorn },
        { value: "battle-scarred", label: copy.trade.wearBattleScarred }
      ], { emptyLabel: copy.trade.allWear }),
      tradeFilterMarkup("trade-rarity-filter", "rarity", tradeState.rarity, [
        { value: "consumer", label: copy.trade.rarityConsumer },
        { value: "industrial", label: copy.trade.rarityIndustrial },
        { value: "mil-spec", label: copy.trade.rarityMilSpec },
        { value: "restricted", label: copy.trade.rarityRestricted },
        { value: "classified", label: copy.trade.rarityClassified },
        { value: "covert", label: copy.trade.rarityCovert },
        { value: "extraordinary", label: copy.trade.rarityExtraordinary }
      ], { emptyLabel: copy.trade.allRarity }),
      tradeFilterMarkup("trade-stattrak-filter", "stattrak", tradeState.stattrak, [
        { value: "yes", label: copy.trade.has },
        { value: "no", label: copy.trade.hasNot }
      ], { emptyLabel: copy.trade.any }),
      tradeFilterMarkup("trade-stickers-filter", "stickers", tradeState.stickers, [
        { value: "yes", label: copy.trade.has },
        { value: "no", label: copy.trade.hasNot }
      ], { emptyLabel: copy.trade.any }),
      tradeFilterMarkup("trade-charms-filter", "charms", tradeState.charms, [
        { value: "yes", label: copy.trade.has },
        { value: "no", label: copy.trade.hasNot }
      ], { emptyLabel: copy.trade.any })
    );
  } else {
    filters.push(
      tradeFilterMarkup("trade-minigame-filter", "miniGame", tradeState.miniGame, [
        { value: "rivals", label: copy.trade.rivals }
      ], { emptyLabel: copy.trade.any }),
      `<p class="trade-filter-note">${escapeHtml(copy.trade.rivalsFiltersComingSoon)}</p>`
    );
  }
  $("#trade-specific-filters").innerHTML = filters.join("");
}

function focusTradeFilterOption(filterId, value) {
  const panel = document.getElementById(`${filterId}-options`);
  [...panel.querySelectorAll("input")].find((input) => input.value === value)?.focus({ preventScroll: true });
}

function updateTradePriceRange(minPrice = tradeState.minPrice, maxPrice = tradeState.maxPrice) {
  const safeMin = Number.isFinite(Number(minPrice)) ? Number(minPrice) : 0;
  const safeMax = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : 50000;
  tradeState.minPrice = Math.max(0, Math.min(50000, Math.round(safeMin / 100) * 100));
  tradeState.maxPrice = Math.max(tradeState.minPrice, Math.min(50000, Math.round(safeMax / 100) * 100));
  $("#trade-price-min").value = tradeState.minPrice;
  $("#trade-price-max").value = tradeState.maxPrice;
  $("#trade-range-min").value = tradeState.minPrice;
  $("#trade-range-max").value = tradeState.maxPrice;
  const minPercent = tradeState.minPrice / 500;
  const maxPercent = tradeState.maxPrice / 500;
  $(".trade-range-track").style.background = `linear-gradient(to right, #33434b ${minPercent}%, #50dbc5 ${minPercent}%, #50dbc5 ${maxPercent}%, #33434b ${maxPercent}%)`;
  $("#trade-range-min").style.zIndex = tradeState.minPrice > 45000 ? "4" : "3";
  $("#trade-range-max").style.zIndex = tradeState.minPrice > 45000 ? "3" : "4";
  renderTradeItems();
}

function resetTradeFilters() {
  Object.assign(tradeState, {
    category: [],
    game: "CS2",
    search: "",
    sort: "featured",
    minPrice: 0,
    maxPrice: 50000,
    wear: [],
    rarity: [],
    stattrak: [],
    stickers: [],
    charms: [],
    miniGame: [],
    openFilter: ""
  });
  renderTradeFilters();
  updateTradePriceRange();
}

function matchesGameFilters(filterState, product) {
  if (filterState.game === "ROBLOX RIVALS" && filterState.miniGame.length
    && !filterState.miniGame.includes(product.miniGame)) return false;
  if (filterState.game === "CS2") {
    if (filterState.wear.length && !filterState.wear.includes(product.wearCondition)) return false;
    if (filterState.rarity.length && !filterState.rarity.includes(product.rarityColor)) return false;
    if (filterState.stattrak.length && !filterState.stattrak.includes(product.stattrak ? "yes" : "no")) return false;
    if (filterState.stickers.length && !filterState.stickers.includes(product.hasStickers ? "yes" : "no")) return false;
    if (filterState.charms.length && !filterState.charms.includes(product.hasCharm ? "yes" : "no")) return false;
  }
  return true;
}

function visibleProducts(filterState = state) {
  const term = filterState.search.trim().toLocaleLowerCase("zh-Hant");
  const visible = products.filter((product) => {
    if (!isProductPublished(product)) return false;
    const matchesCategory = filterState === tradeState
      ? !filterState.category.length || filterState.category.some((category) => product.category === category || product.kind === category)
      : !filterState.categories.length || filterState.categories.some((category) => product.category === category || product.kind === category);
    const matchesGame = filterState.game === "all" || product.game === filterState.game;
    const matchesSearch = !term || [product.name, product.game, product.category, product.description, product.wear, ...(product.tags || [])].some((value) => value.toLocaleLowerCase("zh-Hant").includes(term));
    if (!matchesCategory || !matchesGame || !matchesSearch) return false;
    if (filterState !== tradeState) {
      if (filterState.tags.length && !filterState.tags.some((tag) => (product.tags || []).includes(tag))) return false;
      return matchesGameFilters(filterState, product);
    }
    if (!Number.isFinite(product.price) || product.price < tradeState.minPrice
      || (tradeState.maxPrice < 50000 && product.price > tradeState.maxPrice)) return false;
    return matchesGameFilters(tradeState, product);
  });
  const sorters = {
    featured: (a, b) => products.indexOf(a) - products.indexOf(b),
    "price-ascending": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    "price-descending": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    "stock-descending": (a, b) => b.stock - a.stock,
    "name-ascending": (a, b) => a.name.localeCompare(b.name, "zh-Hant")
  };
  const sorter = sorters[filterState.sort] || sorters.featured;
  return visible.sort(sorter);
}

function renderProducts() {
  const visible = visibleProducts();
  productGrid.innerHTML = visible.map((product) => productCardMarkup(product)).join("");
  $("#product-total").textContent = visible.length;
  $("#empty-state").hidden = visible.length > 0 || !catalogLoaded;
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

function productCardMarkup(product, tradeMode = false, tradeSide = "receive") {
  const favoriteKey = productFavoriteKey(product);
  const favorite = state.favorites.has(favoriteKey);
  const favoriteCount = favoriteCounts.get(favoriteDocumentId(product)) || 0;
  const safeName = escapeHtml(product.name);
  const favoriteIcon = favorite
    ? "heart_minus_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png"
    : "heart_plus_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png";
  const priced = Number.isFinite(product.price) && product.price > 0;
  const isDemo = product.source === "demo";
  const artwork = product.iconUrl
    ? `<img class="product-art steam-product-art" src="${escapeHtml(product.iconUrl)}" alt="${safeName}" loading="lazy">`
    : productArtwork(product);
  const stockLabel = product.source === "steam" || product.wear === copy.product.notApplicable
    ? escapeHtml(t("product.stock", { amount: product.stock }))
    : escapeHtml(t("product.float", { wear: product.wear }));
  const favoriteLabel = favorite ? t("product.favoriteRemove") : t("product.favoriteAdd");
  const addLabel = isDemo
    ? t("product.demoUnavailable")
    : priced && product.stock > 0
    ? t("product.addToCart", { name: product.name })
    : !priced ? t("product.unpriced", { name: product.name }) : t("product.outOfStock", { name: product.name });
  const tradeSelected = tradeMode && tradeState.receive.includes(product.id);
  const tradeActionLabel = tradeSelected ? t("trade.selectedItemLabel") : t(tradeSide === "offer" ? "trade.addToOffer" : "trade.addToReceive");
  const actionButton = tradeMode
    ? `<button class="add-button" type="button" data-trade-add="${escapeHtml(product.id)}" data-trade-side="${tradeSide}" aria-label="${escapeHtml(tradeActionLabel)}：${safeName}" ${tradeSelected || product.stock === 0 || !priced ? "disabled" : ""}><img src="assets/icon_new/add_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png" alt="" aria-hidden="true"></button>`
    : `<button class="add-button" type="button" data-add="${escapeHtml(product.id)}" aria-label="${escapeHtml(addLabel)}" ${isDemo || product.stock === 0 || !priced ? "disabled" : ""}><img src="assets/icon_new/add_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png" alt="" aria-hidden="true"></button>`;
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
        ${isDemo ? "" : `<div class="product-description">${escapeHtml(product.description)}${product.wear === copy.product.notApplicable ? "" : ` <span>／ ${escapeHtml(product.wear)}</span>`}</div>`}
        ${product.tags?.length ? `<div class="product-tags">${product.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        <div class="product-favorite-count">${escapeHtml(t("home.marketFavoriteCount", { count: favoriteCount }))}</div>
        <div class="product-bottom">
          <div class="product-price">${priced ? `<span class="currency-symbol">${escapeHtml(t("product.currency"))}</span>${product.price.toLocaleString()}` : `<span class="unpriced-label">${escapeHtml(t("product.noPrice"))}</span>`}</div>
          ${isDemo ? "" : `<div class="product-stock">${product.stock === 0 ? escapeHtml(t("product.unavailable")) : stockLabel}</div>`}
          ${actionButton}
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
  return product.id;
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
  const featured = uniqueProducts.sort((a, b) => sorter(a, b) || a.name.localeCompare(b.name, "zh-Hant")).slice(0, 5);
  $("#featured-grid").innerHTML = featured.map((product) => productCardMarkup(product)).join("");
  $("#featured-grid").hidden = featured.length === 0;
  featured.forEach(checkFavoriteStatus);
}

function checkFavoriteStatus(product) {
  if (typeof window.eloGetProductFavorite !== "function") return;
  const key = productFavoriteKey(product);
  if (favoriteStatusChecks.has(key)) return;
  favoriteStatusChecks.add(key);
  window.eloGetProductFavorite(product).then((isFavorite) => {
    const changed = isFavorite !== state.favorites.has(key);
    if (isFavorite) state.favorites.add(key);
    else state.favorites.delete(key);
    if (!changed) return;
    renderProducts();
    renderHomeProducts();
    renderProfileFavorites();
  }).catch(() => favoriteStatusChecks.delete(key));
}

function renderProfileFavorites() {
  const page = $("#page-profile");
  if (!page || page.hidden || !window.eloAuthUser) return;
  products.forEach(checkFavoriteStatus);
  const favorites = products.filter((product) => state.favorites.has(productFavoriteKey(product)));
  $("#profile-favorites-grid").innerHTML = favorites.map((product) => productCardMarkup(product)).join("");
  $("#profile-favorites-grid").hidden = favorites.length === 0;
  $("#profile-favorites-count").textContent = favorites.length;
  $("#profile-favorites-empty").hidden = favorites.length > 0;
}

function tradeTotal(side) {
  if (side === "offer") return tradeState.offer.reduce((total, item) => total + (Number(item.value) || 0), 0);
  return tradeState[side].reduce((total, id) => {
    const product = products.find((item) => item.id === id);
    return total + (Number.isFinite(product?.price) ? product.price : 0);
  }, 0);
}

function renderOfferSide() {
  const container = $("#trade-offer-items");
  const selectedMarkup = tradeState.offer.map((item) => {
    const removeLabel = t("trade.removeOffer", { name: item.name });
    const art = /^https:\/\//.test(item.iconUrl || "")
      ? `<img src="${escapeHtml(item.iconUrl)}" alt="" loading="lazy">`
      : `<span class="product-art-placeholder" aria-hidden="true">${escapeHtml(copy.games.cs2)}</span>`;
    return `<div class="trade-selected-item"><div class="trade-selected-art">${art}</div><div class="trade-selected-info"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${item.value ? `${Number(item.value).toLocaleString()} EC` : escapeHtml(t("trade.offerNoValue"))}</small></div><button type="button" data-trade-remove="${escapeHtml(item.id)}" data-trade-side="offer" aria-label="${escapeHtml(removeLabel)}">×</button></div>`;
  }).join("");
  const placeholders = Array.from({ length: Math.max(0, 4 - tradeState.offer.length) }, () =>
    `<div class="trade-slot"><span aria-hidden="true">+</span><small>${escapeHtml(t("trade.emptyOffer"))}</small></div>`
  ).join("");
  container.innerHTML = selectedMarkup + placeholders;
  $("#trade-your-total").textContent = tradeTotal("offer").toLocaleString();
}

function renderTradeSide(side, container, emptyKey, totalElement) {
  const selected = tradeState[side];
  const selectedMarkup = selected.map((id) => {
    const product = products.find((item) => item.id === id);
    if (!product) return "";
    const art = product.iconUrl
      ? `<img src="${escapeHtml(product.iconUrl)}" alt="" loading="lazy">`
      : productArtwork(product);
    const removeLabel = t(side === "offer" ? "trade.removeOffer" : "trade.removeReceive", { name: product.name });
    return `<div class="trade-selected-item"><div class="trade-selected-art">${art}</div><div class="trade-selected-info"><strong title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</strong><small>${product.price.toLocaleString()} EC</small></div><button type="button" data-trade-remove="${escapeHtml(id)}" data-trade-side="${side}" aria-label="${escapeHtml(removeLabel)}">×</button></div>`;
  }).join("");
  const placeholders = Array.from({ length: Math.max(0, 4 - selected.length) }, () =>
    `<div class="trade-slot"><span aria-hidden="true">+</span><small>${escapeHtml(t(emptyKey))}</small></div>`
  ).join("");
  container.innerHTML = selectedMarkup + placeholders;
  totalElement.textContent = tradeTotal(side).toLocaleString();
}

function renderTrade() {
  renderOfferSide();
  if (typeof renderOwnInventory === "function" && $("#trade-own-grid")) renderOwnInventory();
  renderTradeSide("receive", $("#trade-receive-items"), "trade.emptyReceive", $("#trade-receive-total"));
  const difference = tradeTotal("receive") - tradeTotal("offer");
  $("#trade-after-balance-value").textContent = Math.max(0, difference).toLocaleString();
}

function renderTradeItems() {
  const visibleItems = visibleProducts(tradeState).filter((product) => Number.isFinite(product.price) && product.price > 0 && product.stock > 0);
  $("#trade-item-count").textContent = visibleItems.length;
  $("#trade-grid").innerHTML = visibleItems.map((product) => productCardMarkup(product, true, "receive")).join("");
  $("#trade-empty").hidden = visibleItems.length > 0 || !catalogLoaded;
  $("#trade-grid").hidden = visibleItems.length === 0;
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

function setCatalog(nextProducts) {
  products.splice(0, products.length, ...nextProducts);
  catalogLoaded = true;
  renderFilters();
  tradeState.receive = tradeState.receive.filter((id) => products.some((product) => product.id === id));
  renderAllProductViews();
  window.dispatchEvent(new Event("catalogproductschange"));
}

window.addEventListener("listingschange", (event) => {
  const { listings, error } = event.detail || {};
  if (error) {
    console.warn("Listings unavailable, showing demo products:", error);
    setCatalog(demoProducts);
    return;
  }
  setCatalog((listings || [])
    .map(listingProduct)
    .filter((product) => product.name)
    .sort((a, b) => b.createdAt - a.createdAt));
});

function renderAllProductViews() {
  for (const [id, quantity] of state.cart) {
    const product = products.find((item) => item.id === id);
    if (!product || !Number.isFinite(product.price) || product.stock < quantity) state.cart.delete(id);
  }
  renderProducts();
  renderHomeProducts();
  renderTrade();
  renderTradeItems();
  renderCart();
  renderProfileFavorites();
}

function defaultFaqItems() {
  return Object.values(copy.home.faqItems).map(({ question, answer }) => ({ question, answer }));
}

function renderFaq() {
  const items = (Array.isArray(window.eloFaqItems) ? window.eloFaqItems : defaultFaqItems())
    .filter((item) => item.question.trim() || item.answer.trim());
  const list = $(".home-faq-list");
  list.innerHTML = items.map((item, index) => {
    const open = index === 0;
    return `
      <div class="home-faq-item${open ? " is-open" : ""}">
        <button class="home-faq-trigger" type="button" aria-expanded="${open}" aria-controls="faq-answer-${index}">
          <span>${escapeHtml(item.question)}</span>
          <span class="home-faq-icons" aria-hidden="true">
            <img class="home-faq-icon-add" src="assets/icon_new/add_circle_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png" alt="">
            <img class="home-faq-icon-minus" src="assets/icon_new/minus_circle_256dp_E3E3E3_FILL0_wght400_GRAD0_opsz48.png" alt="">
          </span>
        </button>
        <div class="home-faq-answer" id="faq-answer-${index}" aria-hidden="${!open}"${open ? "" : " inert"}>
          <div class="home-faq-answer-inner"><p>${escapeHtml(item.answer)}</p></div>
        </div>
      </div>`;
  }).join("");
  $(".home-faq").hidden = items.length === 0;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

function updateNavIndicator() {
  const nav = document.querySelector(".main-nav");
  const activeLink = nav?.querySelector(".nav-link.active");
  const indicator = nav?.querySelector(".nav-active-indicator");
  if (!activeLink || !indicator) return;
  indicator.style.width = `${activeLink.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeLink.offsetLeft}px)`;
}

function updateMarketIndicator() {
  const tabs = document.querySelector(".market-tabs");
  const activeTab = tabs?.querySelector(".market-tab.active");
  if (!tabs || !activeTab) return;
  tabs.style.setProperty("--active-tab-left", `${activeTab.offsetLeft}px`);
  tabs.style.setProperty("--active-tab-width", `${activeTab.offsetWidth}px`);
}

function navigateTo(page, shouldScroll = true) {
  const validPages = ["home", "shop", "trade", "profile", "notifications", "wallet", ...(window.eloIsAdmin ? ["admin"] : [])];
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
  updateNavIndicator();
  if (destination === "profile") renderProfileFavorites();
  window.dispatchEvent(new CustomEvent("elopagechange", { detail: { page: destination } }));
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
// ---------- 手機版漢堡選單 ----------

function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  $("#nav-toggle").setAttribute("aria-expanded", String(open));
  $("#nav-toggle").setAttribute("aria-label", t(open ? "nav.menuClose" : "nav.menuOpen"));
  $("#nav-backdrop").hidden = !open;
}

$("#nav-toggle").addEventListener("click", () => setNavOpen(!document.body.classList.contains("nav-open")));
$("#nav-backdrop").addEventListener("click", () => setNavOpen(false));
$("#main-nav").addEventListener("click", (event) => {
  if (event.target.closest("a")) setNavOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("nav-open")) setNavOpen(false);
});
window.matchMedia("(min-width: 721px)").addEventListener("change", (event) => {
  if (event.matches) setNavOpen(false);
});

window.addEventListener("eloauthchange", (event) => {
  renderProfileFavorites();
  document.body.classList.toggle("is-signed-in", Boolean(event.detail?.user));
  const isAdmin = Boolean(event.detail?.isAdmin);
  $("#admin-nav-link").hidden = !isAdmin;
  const onAdminPage = !$("#page-admin").hidden;
  if (location.hash === "#admin" && isAdmin && !onAdminPage) navigateTo("admin", false);
  else if (onAdminPage && !isAdmin) navigateTo("home", false);
  else updateNavIndicator();
});
window.addEventListener("resize", () => {
  updateNavIndicator();
  updateMarketIndicator();
});

function setShopFilterOpen(filterId) {
  state.openFilter = filterId;
  shopFilters.querySelectorAll("[data-shop-filter]").forEach((filter) => {
    const open = filter.dataset.shopFilter === filterId;
    filter.classList.toggle("is-open", open);
    filter.querySelector("[data-shop-filter-toggle]").setAttribute("aria-expanded", String(open));
    const panel = filter.querySelector(".trade-filter-panel");
    panel.setAttribute("aria-hidden", String(!open));
    panel.inert = !open;
  });
}

shopFilters.addEventListener("click", (event) => {
  if (event.target.closest("[data-shop-reset]")) {
    Object.assign(state, structuredClone(SHOP_GAME_FILTERS), { tags: [], game: "all", sort: "featured", openFilter: "" });
    renderFilters();
    renderProducts();
    return;
  }
  const toggle = event.target.closest("[data-shop-filter-toggle]");
  if (!toggle) return;
  const filterId = toggle.dataset.shopFilterToggle;
  setShopFilterOpen(state.openFilter === filterId ? "" : filterId);
});

shopFilters.addEventListener("change", (event) => {
  const input = event.target.closest("[data-filter-value]");
  if (!input) return;
  const filterId = input.closest("[data-shop-filter]").dataset.shopFilter;
  const value = input.value;
  if (filterId === "shop-game-filter") {
    if (state.game !== value) Object.assign(state, structuredClone(SHOP_GAME_FILTERS));
    state.game = value;
  } else if (filterId === "shop-sort-filter") state.sort = value;
  else {
    const key = SHOP_FILTER_KEYS[filterId];
    if (!key) return;
    state[key] = input.checked ? [...new Set([...state[key], value])] : state[key].filter((item) => item !== value);
  }
  renderFilters();
  setShopFilterOpen(input.type === "radio" ? "" : filterId);
  if (input.type !== "radio") {
    [...shopFilters.querySelectorAll(`#${filterId}-options input`)].find((item) => item.value === value)?.focus({ preventScroll: true });
  }
  renderProducts();
});

document.addEventListener("click", (event) => {
  if (!state.openFilter || event.target.closest("#shop-filters")) return;
  setShopFilterOpen("");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.openFilter) setShopFilterOpen("");
});

$("#trade-specific-filters").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-filter-toggle]");
  if (!toggle) return;
  const filterId = toggle.dataset.filterToggle;
  const filter = toggle.closest(".trade-filter");
  const panel = document.getElementById(`${filterId}-options`);
  const expanded = toggle.getAttribute("aria-expanded") !== "true";
  $("#trade-specific-filters").querySelectorAll(".trade-filter").forEach((otherFilter) => {
    const otherToggle = otherFilter.querySelector("[data-filter-toggle]");
    const otherPanel = otherFilter.querySelector(".trade-filter-panel");
    const isOpen = otherFilter === filter && expanded;
    otherFilter.classList.toggle("is-open", isOpen);
    otherToggle.setAttribute("aria-expanded", String(isOpen));
    otherPanel.setAttribute("aria-hidden", String(!isOpen));
    otherPanel.inert = !isOpen;
  });
  tradeState.openFilter = expanded ? filterId : "";
});

$("#trade-specific-filters").addEventListener("change", (event) => {
  const input = event.target.closest("[data-trade-filter-value]");
  if (!input) return;
  const filterKey = {
    "trade-type-filter": "category",
    "trade-wear-filter": "wear",
    "trade-rarity-filter": "rarity",
    "trade-stattrak-filter": "stattrak",
    "trade-stickers-filter": "stickers",
    "trade-charms-filter": "charms",
    "trade-minigame-filter": "miniGame"
  }[input.closest("[data-trade-filter]").dataset.tradeFilter];

  if (input.closest("[data-trade-filter]").dataset.tradeFilter === "trade-game-filter") {
    tradeState.game = input.value;
    tradeState.category = [];
    tradeState.wear = [];
    tradeState.rarity = [];
    tradeState.stattrak = [];
    tradeState.stickers = [];
    tradeState.charms = [];
    tradeState.miniGame = [];
    tradeState.openFilter = "trade-game-filter";
    renderTradeFilters();
    focusTradeFilterOption("trade-game-filter", input.value);
    renderTradeItems();
    return;
  }
  if (!filterKey) return;
  if (input.checked) {
    if (!tradeState[filterKey].includes(input.value)) tradeState[filterKey].push(input.value);
  } else {
    tradeState[filterKey] = tradeState[filterKey].filter((value) => value !== input.value);
  }
  tradeState.openFilter = input.closest("[data-trade-filter]").dataset.tradeFilter;
  const filterId = tradeState.openFilter;
  const selectedValue = input.value;
  renderTradeFilters();
  focusTradeFilterOption(filterId, selectedValue);
  renderTradeItems();
});

$("#trade-price-min").addEventListener("change", (event) => {
  const minPrice = Math.max(0, Math.min(50000, Number(event.target.value) || 0));
  updateTradePriceRange(minPrice, Math.max(minPrice, tradeState.maxPrice));
});

$("#trade-price-max").addEventListener("change", (event) => {
  const maxPrice = Math.max(0, Math.min(50000, Number(event.target.value) || 0));
  updateTradePriceRange(Math.min(tradeState.minPrice, maxPrice), maxPrice);
});

$("#trade-range-min").addEventListener("input", (event) => {
  updateTradePriceRange(Number(event.target.value), Math.max(Number(event.target.value), tradeState.maxPrice));
});

$("#trade-range-max").addEventListener("input", (event) => {
  updateTradePriceRange(Math.min(tradeState.minPrice, Number(event.target.value)), Number(event.target.value));
});

$("#trade-reset-filters").addEventListener("click", resetTradeFilters);

document.addEventListener("click", (event) => {
  if (event.target.closest("#trade-specific-filters")) return;
  if (!tradeState.openFilter) return;
  tradeState.openFilter = "";
  $("#trade-specific-filters").querySelectorAll(".trade-filter").forEach((filter) => {
    filter.classList.remove("is-open");
    const toggle = filter.querySelector("[data-filter-toggle]");
    const panel = filter.querySelector(".trade-filter-panel");
    toggle.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !tradeState.openFilter) return;
  tradeState.openFilter = "";
  $("#trade-specific-filters").querySelectorAll(".trade-filter").forEach((filter) => {
    filter.classList.remove("is-open");
    filter.querySelector("[data-filter-toggle]").setAttribute("aria-expanded", "false");
    const panel = filter.querySelector(".trade-filter-panel");
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
  });
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
  const category = button.dataset.homeCategory;
  state.categories = [category];
  if (category === copy.categories.item) state.game = "all";
  else if ([copy.categories.rivals, copy.categories.competitor].includes(category)) state.game = "ROBLOX RIVALS";
  else state.game = "CS2";
  renderFilters();
  history.pushState(null, "", "#shop");
  navigateTo("shop");
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
    updateMarketIndicator();
    renderHomeProducts();
  });
});

function handleTradeInventoryClick(event) {
  const button = event.target.closest("[data-trade-add]");
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.tradeAdd);
  if (!product || !isProductPublished(product) || product.stock === 0 || !Number.isFinite(product.price)) return;
  if (tradeState.receive.includes(product.id)) {
    showToast(t("trade.alreadySelected"));
    return;
  }
  tradeState.receive.push(product.id);
  renderTrade();
  renderTradeItems();
}

$("#trade-grid").addEventListener("click", handleTradeInventoryClick);

for (const side of ["offer", "receive"]) {
  $(`#trade-${side}-items`).addEventListener("click", (event) => {
    const button = event.target.closest("[data-trade-remove]");
    if (!button) return;
    const removeId = button.dataset.tradeRemove;
    if (button.dataset.tradeSide === "offer") {
      tradeState.offer = tradeState.offer.filter((item) => item.id !== removeId);
    } else {
      tradeState.receive = tradeState.receive.filter((id) => id !== removeId);
    }
    renderTrade();
    renderTradeItems();
  });
}

// ---------- 交易頁：讀取自己的 Steam 庫存 ----------

const STEAM_ICON_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";
const ownInventory = { steamId: "", items: [], savedAt: 0 };

function tradeUrlSteamId() {
  try {
    const partner = new URL(window.eloUserProfile?.tradeUrl || "").searchParams.get("partner") || "";
    return /^\d{1,10}$/.test(partner) ? (76561197960265728n + BigInt(partner)).toString() : "";
  } catch {
    return "";
  }
}

function inventoryStorageKey() {
  return window.eloAuthUser ? `eloskin2.inventory.${window.eloAuthUser.uid}` : "";
}

function setInventoryStatus(message, kind = "") {
  $("#trade-inv-status").textContent = message;
  $("#trade-inv-status").dataset.kind = kind;
}

const updateTradeBookmarklet = window.eloInventoryImport.bindBookmarklet({
  link: $("#trade-bookmarklet"),
  copyButton: $("#trade-bookmarklet-copy"),
  status: $("#trade-bookmarklet-status"),
  text: t
});

function saveOwnInventory(items, savedAt = Date.now()) {
  ownInventory.items = items;
  ownInventory.savedAt = savedAt;
  try {
    localStorage.setItem(inventoryStorageKey(), JSON.stringify({ steamId: ownInventory.steamId, items, savedAt }));
  } catch {
    // 存不進本機也沒關係，這次照常使用
  }
}

let inventoryNotice = null;

function restoreOwnInventory() {
  const steamId = tradeUrlSteamId();
  if (steamId !== ownInventory.steamId) inventoryNotice = null;
  ownInventory.steamId = steamId;
  ownInventory.items = [];
  ownInventory.savedAt = 0;
  const key = inventoryStorageKey();
  if (key && steamId) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved?.steamId === steamId && Array.isArray(saved.items)) {
        ownInventory.items = saved.items;
        ownInventory.savedAt = Number(saved.savedAt) || 0;
      }
    } catch {
      // 讀不到本機紀錄就當作沒有
    }
  }
  const pending = window.eloInventoryImport.pending("trade");
  if (pending && key && steamId) {
    window.eloInventoryImport.clearPending("trade");
    if (pending.steamId === steamId) {
      saveOwnInventory(pending.items);
      inventoryNotice = { message: t("inventory.imported", { count: pending.items.length }), kind: "success" };
    } else {
      inventoryNotice = { message: t("inventory.wrongAccount"), kind: "error" };
    }
  }
  renderOwnInventory();
}

function ownItemPriceLabel(item) {
  if (!window.eloPrices?.loaded()) return t("trade.priceLoading");
  const ec = window.eloPrices.ec(item.marketHashName);
  return ec === null ? t("trade.priceUnknown") : t("trade.priceEstimate", { ec: ec.toLocaleString() });
}

function renderOwnInventory() {
  const signedIn = Boolean(window.eloAuthUser);
  const steamId = ownInventory.steamId;
  const link = $("#trade-inv-open");
  const paste = $("#trade-inv-paste");
  paste.hidden = !signedIn || !steamId;
  if (steamId) link.href = `https://steamcommunity.com/inventory/${steamId}/730/2?l=tchinese&count=2000`;
  else link.removeAttribute("href");
  updateTradeBookmarklet(steamId, "trade");
  const hasItems = ownInventory.items.length > 0;
  if (hasItems && window.eloPrices && !window.eloPrices.loaded()) window.eloPrices.load();
  $("#trade-inv-search").hidden = !hasItems;
  $("#trade-own-count").textContent = hasItems ? t("trade.inventoryCount", { count: ownInventory.items.length }) : "";
  paste.querySelector("summary").textContent = hasItems ? t("trade.inventoryReload") : t("trade.inventoryLoad");
  if (inventoryNotice && signedIn) {
    setInventoryStatus(inventoryNotice.message, inventoryNotice.kind);
  } else if (!signedIn) setInventoryStatus(t("trade.inventoryNeedLogin"));
  else if (!steamId) setInventoryStatus(t("trade.inventoryNeedTradeUrl"));
  else if (hasItems) {
    setInventoryStatus(t("trade.inventoryLoaded", {
      count: ownInventory.items.length,
      time: new Date(ownInventory.savedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    }), "success");
  } else setInventoryStatus("");

  const term = $("#trade-inv-search").value.trim().toLocaleLowerCase("zh-Hant");
  const selected = new Set(tradeState.offer.map((item) => item.assetId).filter(Boolean));
  const visible = ownInventory.items.filter((item) => !term || `${item.name} ${item.type}`.toLocaleLowerCase("zh-Hant").includes(term));
  $("#trade-own-grid").innerHTML = hasItems && !visible.length
    ? `<p class="trade-filter-note">${escapeHtml(t("trade.inventoryEmpty"))}</p>`
    : visible.map((item) => `
      <button class="trade-own-item${selected.has(item.assetId) ? " is-selected" : ""}" type="button" data-own-asset="${escapeHtml(item.assetId)}" aria-label="${escapeHtml(t("trade.inventoryAdd", { name: item.name }))}"${selected.has(item.assetId) ? " disabled" : ""}>
        <span class="trade-own-art">${item.iconUrl ? `<img src="${escapeHtml(item.iconUrl)}" alt="" loading="lazy">` : ""}</span>
        <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(item.type)}</small>
        <em class="trade-own-price">${escapeHtml(ownItemPriceLabel(item))}</em>
      </button>`).join("");
}

$("#trade-inv-load").addEventListener("click", () => {
  try {
    const { items, truncated } = window.eloInventoryImport.parse($("#trade-inv-input").value, t);
    if (!items.length) throw new Error(truncated ? t("inventory.truncated", { count: 0 }) : t("admin.pasteNoTradable"));
    saveOwnInventory(items);
    $("#trade-inv-input").value = "";
    inventoryNotice = truncated ? { message: t("inventory.truncated", { count: items.length }), kind: "error" } : null;
    if (!truncated) $("#trade-inv-paste").open = false;
    renderOwnInventory();
  } catch (error) {
    setInventoryStatus(error.message, "error");
  }
});

$("#trade-inv-search").addEventListener("input", renderOwnInventory);

$("#trade-own-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-own-asset]");
  if (!button) return;
  const item = ownInventory.items.find((entry) => entry.assetId === button.dataset.ownAsset);
  if (!item || tradeState.offer.some((entry) => entry.assetId === item.assetId)) return;
  if (tradeState.offer.length >= 20) {
    showToast(t("trade.offerLimit"));
    return;
  }
  const marketEc = window.eloPrices?.ec(item.marketHashName) ?? null;
  tradeState.offer.push({ id: `asset-${item.assetId}`, name: item.name, value: marketEc || 0, autoValue: true, assetId: item.assetId, marketHashName: item.marketHashName, iconUrl: item.iconUrl });
  renderTrade();
});

window.addEventListener("eloauthchange", restoreOwnInventory);
window.addEventListener("eloprofilechange", restoreOwnInventory);
window.addEventListener("elopricesloaded", () => {
  for (const item of tradeState.offer) {
    if (item.autoValue && !item.value) item.value = window.eloPrices.ec(item.marketHashName) || 0;
  }
  renderTrade();
});

$("#trade-submit").addEventListener("click", () => {
  if (!tradeState.offer.length || !tradeState.receive.length) {
    showToast(t("trade.itemsRequired"));
    return;
  }
  window.eloOrders?.submitTrade();
});

$(".home-faq-list").addEventListener("click", (event) => {
  const button = event.target.closest(".home-faq-trigger");
  if (!button) return;
  const expanded = button.getAttribute("aria-expanded") !== "true";
  const item = button.closest(".home-faq-item");
  const answer = document.getElementById(button.getAttribute("aria-controls"));
  button.setAttribute("aria-expanded", String(expanded));
  item.classList.toggle("is-open", expanded);
  answer.setAttribute("aria-hidden", String(!expanded));
  answer.inert = !expanded;
});

window.addEventListener("faqchange", renderFaq);

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
    renderTradeItems();
    renderHomeProducts();
    renderProfileFavorites();
    showToast(shouldFavorite ? t("messages.favoriteAdded") : t("messages.favoriteRemoved"));
    const toggleFavorite = window.eloToggleProductFavorite;
    if (typeof toggleFavorite === "function") {
      toggleFavorite(product, shouldFavorite).then((result) => {
        if (result) {
          if (result.isFavorite) state.favorites.add(key);
          else state.favorites.delete(key);
          favoriteCounts.set(favoriteDocumentId(product), result.count);
          renderProducts();
          renderTradeItems();
          renderHomeProducts();
          renderProfileFavorites();
        }
      }).catch(() => {
        if (shouldFavorite) state.favorites.delete(key);
        else state.favorites.add(key);
        renderProducts();
        renderTradeItems();
        renderHomeProducts();
        renderProfileFavorites();
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

window.addEventListener("favoritecountschanged", (event) => {
  favoriteCounts.clear();
  for (const [id, count] of Object.entries(event.detail || {})) favoriteCounts.set(id, count);
  renderProducts();
  renderTradeItems();
  renderHomeProducts();
  renderProfileFavorites();
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
  window.eloOrders?.submitPurchase();
});

window.eloApp = {
  products,
  showToast,
  escapeHtml,
  navigateTo,
  closeCart,
  cartEntries: () => [...state.cart.entries()].map(([id, quantity]) => ({ product: products.find((item) => item.id === id), quantity }))
    .filter((entry) => entry.product),
  clearCart: () => {
    state.cart.clear();
    renderCart();
  },
  tradeSelection: () => ({
    offer: tradeState.offer.map((item) => ({ ...item })),
    receive: tradeState.receive.map((id) => products.find((item) => item.id === id)).filter(Boolean),
    offerTotal: tradeTotal("offer"),
    receiveTotal: tradeTotal("receive")
  }),
  clearTrade: () => {
    tradeState.offer = [];
    tradeState.receive = [];
    renderTrade();
    renderTradeItems();
  }
};

renderFaq();
renderFilters();
renderTradeFilters();
renderHomeCategories();
renderProducts();
renderTrade();
renderTradeItems();
renderHomeProducts();
renderCart();
updateMarketIndicator();
const initialDestination = location.hash.slice(1) || "home";
if (["guide", "safety", "marketplace"].includes(initialDestination)) showHomeAnchor(initialDestination);
else {
  navigateTo(initialDestination);
}
updateTradePriceRange();
if (Array.isArray(window.eloListings)) {
  window.dispatchEvent(new CustomEvent("listingschange", { detail: { listings: window.eloListings } }));
}

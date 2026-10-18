const STEAM_ID64 = "76561199883868233";
const APP_ID = "730";
const CONTEXT_ID = "2";
const PAGE_SIZE = 2000;
const MAX_PAGES = 10;
const ICON_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function iconUrl(icon) {
  if (typeof icon !== "string" || !icon) return "";
  const safePath = icon.split("/").map(encodeURIComponent).join("/");
  return `${ICON_BASE}${safePath}`;
}

function inventoryItems(assets, descriptions) {
  const descriptionsByKey = new Map(
    descriptions.map((description) => [`${description.classid}_${description.instanceid}`, description])
  );
  return assets.flatMap((asset) => {
    const description = descriptionsByKey.get(`${asset.classid}_${asset.instanceid}`);
    if (!description || Number(description.tradable) !== 1) return [];
    return [{
      assetId: String(asset.assetid),
      amount: Math.max(1, Number.parseInt(asset.amount, 10) || 1),
      name: String(description.name || description.market_hash_name || "CS2 物品"),
      marketHashName: String(description.market_hash_name || description.name || ""),
      type: String(description.type || ""),
      iconUrl: iconUrl(description.icon_url)
    }];
  });
}

async function fetchSteamInventory() {
  const assets = [];
  const descriptionsByKey = new Map();
  let startAssetId = "";
  let reportedTotal = 0;
  let hasMore = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`https://steamcommunity.com/inventory/${STEAM_ID64}/${APP_ID}/${CONTEXT_ID}`);
    url.searchParams.set("l", "tchinese");
    url.searchParams.set("count", String(PAGE_SIZE));
    if (startAssetId) url.searchParams.set("start_assetid", startAssetId);

    const response = await fetch(url, {
      headers: { "User-Agent": "ELOSKIN2 inventory reader" },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    if (!response.ok) {
      return { error: response.status === 429 ? "steam_rate_limited" : "steam_unavailable", status: response.status };
    }

    let pageData;
    try {
      pageData = await response.json();
    } catch {
      return { error: "invalid_steam_response" };
    }
    if (Number(pageData.success) !== 1 || !Array.isArray(pageData.assets) || !Array.isArray(pageData.descriptions)) {
      return { error: "inventory_unavailable" };
    }

    assets.push(...pageData.assets);
    for (const description of pageData.descriptions) {
      descriptionsByKey.set(`${description.classid}_${description.instanceid}`, description);
    }
    reportedTotal = Number(pageData.total_inventory_count) || reportedTotal;
    hasMore = Number(pageData.more_items) === 1 || pageData.more_items === true;
    if (!hasMore || !pageData.last_assetid) break;
    startAssetId = String(pageData.last_assetid);
  }

  return {
    items: inventoryItems(assets, [...descriptionsByKey.values()]),
    totalInventoryCount: reportedTotal,
    truncated: hasMore
  };
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const originAllowed = !origin || allowedOrigins.includes(origin);
    const corsHeaders = {
      "Vary": "Origin",
      ...(origin && originAllowed ? { "Access-Control-Allow-Origin": origin } : {})
    };

    if (requestUrl.pathname !== "/inventory") {
      return jsonResponse({ error: "not_found" }, 404, corsHeaders);
    }
    if (origin && !originAllowed) {
      return jsonResponse({ error: "origin_not_allowed" }, 403, corsHeaders);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);
    }

    let result;
    try {
      result = await fetchSteamInventory();
    } catch {
      return jsonResponse({ error: "steam_unavailable" }, 502, corsHeaders);
    }
    if (result.error) {
      return jsonResponse({ error: result.error }, 502, corsHeaders);
    }
    return jsonResponse({
      items: result.items,
      totalInventoryCount: result.totalInventoryCount,
      tradableQuantity: result.items.reduce((total, item) => total + item.amount, 0),
      truncated: result.truncated
    }, 200, corsHeaders);
  }
};

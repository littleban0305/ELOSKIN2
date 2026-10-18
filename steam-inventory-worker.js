const STEAM_ID64 = "76561199883868233";
const APP_ID = "730";
const CONTEXT_ID = "2";
const PAGE_SIZE = 2000;
const MAX_PAGES = 10;
const ICON_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";
const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const FIREBASE_CUSTOM_TOKEN_AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const STEAM_STATE_COOKIE = "eloskin_steam_state";
const STEAM_STATE_TTL_SECONDS = 600;
const textEncoder = new TextEncoder();

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function textResponse(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacSignature(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

async function signState(payload, secret) {
  const encodedPayload = base64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = base64Url(await hmacSignature(encodedPayload, secret));
  return `${encodedPayload}.${signature}`;
}

async function verifyState(cookie, secret) {
  if (!cookie || !secret) return null;
  const [encodedPayload, encodedSignature, ...extra] = cookie.split(".");
  if (!encodedPayload || !encodedSignature || extra.length) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(encodedSignature),
    textEncoder.encode(encodedPayload)
  );
  if (!isValid) return null;
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload)));
  if (!payload || typeof payload.state !== "string" || payload.expiresAt < Date.now()) return null;
  return payload;
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const entry = cookies.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : "";
}

function stateCookie(value, maxAge = STEAM_STATE_TTL_SECONDS) {
  return `${STEAM_STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/auth/steam/callback; HttpOnly; Secure; SameSite=Lax`;
}

function firebaseKeyBytes(pem) {
  const base64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return decodeBase64Url(base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

async function createFirebaseCustomToken(steamId, env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error("firebase_credentials_missing");
  }
  const serviceAccountEmail = String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL).trim();
  if (!/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(serviceAccountEmail)) {
    throw new Error("firebase_service_account_invalid");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    firebaseKeyBytes(String(env.FIREBASE_PRIVATE_KEY)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(textEncoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(textEncoder.encode(JSON.stringify({
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
    uid: `steam:${steamId}`,
    provider: "steam",
    steamId
  })));
  const unsignedToken = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    textEncoder.encode(unsignedToken)
  ));
  return `${unsignedToken}.${base64Url(signature)}`;
}

function validReturnUrl(value, origins) {
  try {
    const url = new URL(value);
    if (!origins.includes(url.origin) || url.username || url.password || url.href.length > 2048) return null;
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function authRedirect(returnUrl, key, value, clearCookie = false) {
  const destination = new URL(returnUrl);
  destination.hash = `${key}=${encodeURIComponent(value)}`;
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Location": destination.href
  };
  if (clearCookie) headers["Set-Cookie"] = stateCookie("", 0);
  return new Response(null, { status: 303, headers });
}

function callbackError(returnUrl, code) {
  return authRedirect(returnUrl, "steam-error", code, true);
}

function openIdParameters(requestUrl) {
  const parameters = new URLSearchParams();
  const seen = new Set();
  for (const [key, value] of requestUrl.searchParams) {
    if (!key.startsWith("openid.")) continue;
    if (seen.has(key)) return null;
    seen.add(key);
    parameters.set(key, value);
  }
  return parameters;
}

async function steamLoginStart(requestUrl, env) {
  const origins = allowedOrigins(env);
  const returnUrl = validReturnUrl(requestUrl.searchParams.get("returnUrl") || "", origins);
  if (!returnUrl) return textResponse("The return URL is not allowed.", 400);
  if (String(env.STEAM_STATE_SECRET || "").length < 32 || !env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return callbackError(returnUrl.href, "not-configured");
  }

  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const payload = {
    state,
    returnUrl: returnUrl.href,
    expiresAt: Date.now() + STEAM_STATE_TTL_SECONDS * 1000
  };
  const cookie = await signState(payload, env.STEAM_STATE_SECRET);
  const callbackUrl = new URL("/auth/steam/callback", requestUrl.origin);
  callbackUrl.searchParams.set("state", state);

  const openIdUrl = new URL(STEAM_OPENID_URL);
  openIdUrl.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  openIdUrl.searchParams.set("openid.mode", "checkid_setup");
  openIdUrl.searchParams.set("openid.return_to", callbackUrl.href);
  openIdUrl.searchParams.set("openid.realm", `${requestUrl.origin}/`);
  openIdUrl.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  openIdUrl.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");

  return new Response(null, {
    status: 302,
    headers: {
      "Location": openIdUrl.href,
      "Set-Cookie": stateCookie(cookie),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function steamLoginCallback(request, requestUrl, env) {
  let statePayload = null;
  try {
    statePayload = await verifyState(getCookie(request, STEAM_STATE_COOKIE), env.STEAM_STATE_SECRET);
  } catch {
    statePayload = null;
  }
  if (!statePayload || statePayload.state !== requestUrl.searchParams.get("state")) {
    return textResponse("Steam sign-in state is invalid or expired. Please try again.", 400, {
      "Set-Cookie": stateCookie("", 0)
    });
  }

  const returnUrl = validReturnUrl(statePayload.returnUrl, allowedOrigins(env));
  if (!returnUrl) return textResponse("The return URL is not allowed.", 400, { "Set-Cookie": stateCookie("", 0) });
  if (requestUrl.searchParams.get("openid.mode") === "cancel") {
    return callbackError(returnUrl.href, "cancelled");
  }

  const parameters = openIdParameters(requestUrl);
  if (
    !parameters
    || parameters.get("openid.ns") !== "http://specs.openid.net/auth/2.0"
    || parameters.get("openid.mode") !== "id_res"
    || !parameters.get("openid.assoc_handle")
    || !parameters.get("openid.sig")
  ) {
    return callbackError(returnUrl.href, "verification-failed");
  }

  const signedFields = new Set((parameters.get("openid.signed") || "").split(","));
  const requiredSignedFields = ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"];
  if (requiredSignedFields.some((field) => !signedFields.has(field))) {
    return callbackError(returnUrl.href, "verification-failed");
  }
  if (parameters.get("openid.op_endpoint") !== STEAM_OPENID_URL) {
    return callbackError(returnUrl.href, "verification-failed");
  }

  const state = statePayload.state;
  const expectedReturnTo = new URL("/auth/steam/callback", requestUrl.origin);
  expectedReturnTo.searchParams.set("state", state);
  if (parameters.get("openid.return_to") !== expectedReturnTo.href) {
    return callbackError(returnUrl.href, "verification-failed");
  }

  const claimedId = parameters.get("openid.claimed_id") || "";
  const identity = parameters.get("openid.identity") || "";
  const steamMatch = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimedId);
  if (!steamMatch || identity !== claimedId) {
    return callbackError(returnUrl.href, "verification-failed");
  }
  const responseNonce = parameters.get("openid.response_nonce") || "";
  const nonceTimestamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(responseNonce);
  const nonceTime = nonceTimestamp ? Date.parse(nonceTimestamp[1]) : NaN;
  if (!Number.isFinite(nonceTime) || nonceTime < Date.now() - 10 * 60 * 1000 || nonceTime > Date.now() + 60 * 1000) {
    return callbackError(returnUrl.href, "verification-failed");
  }

  const verificationParameters = new URLSearchParams(parameters);
  verificationParameters.set("openid.mode", "check_authentication");
  let verification;
  try {
    verification = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verificationParameters,
      redirect: "error",
      cache: "no-store"
    });
  } catch {
    return callbackError(returnUrl.href, "steam-verification-unavailable");
  }
  if (!verification.ok) return callbackError(returnUrl.href, "steam-verification-unavailable");
  let openIdVerified = false;
  try {
    const verificationBody = await verification.text();
    openIdVerified = verificationBody.split(/\r?\n/).some((line) => line.trim() === "is_valid:true");
  } catch {
    return callbackError(returnUrl.href, "steam-verification-unavailable");
  }
  if (!openIdVerified) {
    return callbackError(returnUrl.href, "verification-failed");
  }

  let customToken;
  try {
    customToken = await createFirebaseCustomToken(steamMatch[1], env);
  } catch {
    return callbackError(returnUrl.href, "firebase-token-failed");
  }
  return authRedirect(returnUrl.href, "steam-auth", customToken, true);
}

function steamXmlValue(xml, tag) {
  const expression = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
  const match = expression.exec(xml);
  return match ? match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
}

async function steamProfile(requestUrl, env) {
  const steamId = requestUrl.searchParams.get("steamId") || "";
  if (!/^\d{17}$/.test(steamId)) {
    return jsonResponse({ error: "invalid_steam_id" }, 400, {});
  }

  let response;
  try {
    response = await fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`, {
      headers: { "Accept": "application/xml, text/xml" },
      redirect: "error",
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
  } catch {
    return jsonResponse({ error: "steam_profile_unavailable" }, 502, {});
  }
  if (!response.ok) return jsonResponse({ error: "steam_profile_unavailable" }, 502, {});

  let xml;
  try {
    xml = await response.text();
  } catch {
    return jsonResponse({ error: "steam_profile_unavailable" }, 502, {});
  }
  const displayName = steamXmlValue(xml, "steamID");
  const avatarUrl = steamXmlValue(xml, "avatarFull");
  let safeAvatarUrl = "";
  try {
    const parsedAvatar = new URL(avatarUrl);
    if (
      parsedAvatar.protocol === "https:"
      && ["avatars.steamstatic.com", "steamcdn-a.akamaihd.net"].includes(parsedAvatar.hostname)
    ) {
      safeAvatarUrl = parsedAvatar.href;
    }
  } catch {
    safeAvatarUrl = "";
  }
  return jsonResponse({
    steamId,
    displayName: displayName.slice(0, 64),
    photoURL: safeAvatarUrl
  }, 200, {});
}

async function handleSteamAuth(request, requestUrl, env) {
  const origin = request.headers.get("Origin");
  const origins = allowedOrigins(env);
  if (origin && !origins.includes(origin)) {
    return textResponse("This website is not allowed to use Steam sign-in.", 403);
  }
  if (request.method !== "GET") return textResponse("Method not allowed.", 405);
  if (requestUrl.pathname === "/auth/steam/start") return steamLoginStart(requestUrl, env);
  if (requestUrl.pathname === "/auth/steam/callback") return steamLoginCallback(request, requestUrl, env);
  if (requestUrl.pathname === "/auth/steam/profile") {
    const corsHeaders = origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
    const response = await steamProfile(requestUrl, env);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
  return textResponse("Not found.", 404);
}

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

    if (requestUrl.pathname.startsWith("/auth/steam/")) {
      return handleSteamAuth(request, requestUrl, env);
    }
    if (requestUrl.pathname !== "/inventory") return jsonResponse({ error: "not_found" }, 404, corsHeaders);
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

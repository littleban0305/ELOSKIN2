const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_USER_AGENT = "ELOSKIN2 Steam authentication";
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

async function serviceAccountKey(env) {
  return crypto.subtle.importKey(
    "pkcs8",
    firebaseKeyBytes(String(env.FIREBASE_PRIVATE_KEY)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signJwt(payload, env) {
  const header = base64Url(textEncoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64Url(textEncoder.encode(JSON.stringify(payload)));
  const unsigned = `${header}.${body}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await serviceAccountKey(env), textEncoder.encode(unsigned)));
  return `${unsigned}.${base64Url(signature)}`;
}

// firebase-adminsdk-xxxx@<專案 ID>.iam.gserviceaccount.com → 專案 ID
function firebaseProjectId(env) {
  if (env.FIREBASE_PROJECT_ID) return String(env.FIREBASE_PROJECT_ID).trim();
  const match = /@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/.exec(String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "").trim());
  return match ? match[1] : "";
}

// 用服務帳戶換 Google API 的 access token（讀寫 Firestore、查 Firebase 使用者用）
let cachedAccessToken = null;
async function googleAccessToken(env) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) return cachedAccessToken.token;
  const email = String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: email,
    sub: email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit"
  }, env);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`google_token_${response.status}_${data.error || "unknown"}`);
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedAccessToken.token;
}

function firestoreUrl(env, path) {
  return `https://firestore.googleapis.com/v1/projects/${firebaseProjectId(env)}/databases/(default)/documents/${path}`;
}

async function firestoreGet(env, path) {
  const response = await fetch(firestoreUrl(env, path), { headers: { Authorization: `Bearer ${await googleAccessToken(env)}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`firestore_get_${response.status}`);
  const data = await response.json();
  const fields = {};
  for (const [key, value] of Object.entries(data.fields || {})) fields[key] = value.stringValue ?? value.integerValue ?? value.booleanValue ?? null;
  return fields;
}

async function firestoreSet(env, path, values) {
  const fields = {};
  for (const [key, value] of Object.entries(values)) {
    fields[key] = typeof value === "number" ? { integerValue: String(Math.round(value)) } : { stringValue: String(value) };
  }
  const response = await fetch(firestoreUrl(env, path), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${await googleAccessToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) throw new Error(`firestore_set_${response.status}`);
}

// 查 Firebase 有沒有這個 uid 的使用者
async function firebaseUserExists(env, uid) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId(env)}/accounts:lookup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleAccessToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: [uid] })
  });
  if (!response.ok) throw new Error(`user_lookup_${response.status}`);
  const data = await response.json();
  return Array.isArray(data.users) && data.users.length > 0;
}

// 驗證網站傳來的 Firebase ID token（綁定 Steam 時用來確認是哪個帳號）
let cachedJwks = null;
async function verifyFirebaseIdToken(idToken, env) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("id_token_format");
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  if (header.alg !== "RS256" || !header.kid) throw new Error("id_token_header");
  if (!cachedJwks || cachedJwks.expiresAt < Date.now()) {
    const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if (!response.ok) throw new Error("id_token_keys");
    cachedJwks = { keys: (await response.json()).keys || [], expiresAt: Date.now() + 3600 * 1000 };
  }
  const jwk = cachedJwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("id_token_kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), textEncoder.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("id_token_signature");
  const projectId = firebaseProjectId(env);
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("id_token_audience");
  if (!(payload.exp > now) || !(payload.iat <= now + 60) || typeof payload.sub !== "string" || !payload.sub) throw new Error("id_token_expired");
  return payload.sub;
}

async function createFirebaseCustomToken(steamId, env, uid = `steam:${steamId}`) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error("firebase_credentials_missing");
  }
  const serviceAccountEmail = String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL).trim();
  if (!/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(serviceAccountEmail)) {
    throw new Error("firebase_service_account_invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  // Firebase 只認 claims 物件裡的自訂欄位，放在最上層會被忽略
  return signJwt({
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
    uid,
    claims: { provider: "steam", steamId }
  }, env);
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

  // mode=link：已登入的帳號要綁定 Steam，網站會一起傳 Firebase ID token
  const mode = requestUrl.searchParams.get("mode") === "link" ? "link" : "login";
  let linkUid = "";
  if (mode === "link") {
    try {
      linkUid = await verifyFirebaseIdToken(requestUrl.searchParams.get("idToken") || "", env);
    } catch {
      return callbackError(returnUrl.href, "link-session-invalid");
    }
    if (linkUid.startsWith("steam:")) return callbackError(returnUrl.href, "link-already-steam");
  }

  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const payload = {
    state,
    mode,
    linkUid,
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
  // 注意：Cloudflare Worker 的 fetch 不支援 cache 選項，加了會直接丟錯（之前 Steam 登入失敗就是這個原因）
  let verification;
  try {
    verification = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/plain",
        "User-Agent": STEAM_USER_AGENT
      },
      body: verificationParameters.toString(),
      redirect: "manual"
    });
  } catch (error) {
    return callbackError(returnUrl.href, `steam-verification-network-error:${String(error.message || "unknown").slice(0, 60)}`);
  }
  if (!verification.ok) {
    return callbackError(returnUrl.href, `steam-verification-http-${verification.status}`);
  }
  let openIdVerified = false;
  try {
    const verificationBody = await verification.text();
    openIdVerified = verificationBody.split(/\r?\n/).some((line) => line.trim() === "is_valid:true");
  } catch {
    return callbackError(returnUrl.href, "steam-verification-response-error");
  }
  if (!openIdVerified) {
    return callbackError(returnUrl.href, "verification-failed");
  }

  const steamId = steamMatch[1];

  // 綁定：把這個 Steam 記到目前帳號底下
  if (statePayload.mode === "link" && statePayload.linkUid) {
    try {
      const existing = await firestoreGet(env, `steamLinks/${steamId}`);
      if (existing?.uid && existing.uid !== statePayload.linkUid) return callbackError(returnUrl.href, "link-steam-taken");
      if (await firebaseUserExists(env, `steam:${steamId}`)) return callbackError(returnUrl.href, "link-steam-has-account");
      const now = Date.now();
      await firestoreSet(env, `steamLinks/${steamId}`, { uid: statePayload.linkUid, linkedAt: now });
      await firestoreSet(env, `accountLinks/${statePayload.linkUid}`, { steamId, linkedAt: now });
    } catch (error) {
      return callbackError(returnUrl.href, `link-failed:${String(error.message || "unknown").slice(0, 60)}`);
    }
    return authRedirect(returnUrl.href, "steam-linked", steamId, true);
  }

  // 登入：這個 Steam 綁過其他帳號的話，就登入那個帳號
  let uid = `steam:${steamId}`;
  try {
    const link = await firestoreGet(env, `steamLinks/${steamId}`);
    if (link?.uid) uid = link.uid;
  } catch (error) {
    return callbackError(returnUrl.href, `link-lookup-failed:${String(error.message || "unknown").slice(0, 60)}`);
  }

  let customToken;
  try {
    customToken = await createFirebaseCustomToken(steamId, env, uid);
  } catch (error) {
    return callbackError(returnUrl.href, `firebase-token-failed:${String(error.message || "unknown").slice(0, 60)}`);
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
      headers: {
        "Accept": "application/xml, text/xml",
        "User-Agent": STEAM_USER_AGENT
      },
      redirect: "manual",
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

// 健康檢查：在手機瀏覽器打開 /auth/steam/health 就知道哪一步壞掉（不會顯示任何金鑰內容）
async function steamHealth(request, env) {
  const checks = {
    allowedOrigins: allowedOrigins(env),
    stateSecret: String(env.STEAM_STATE_SECRET || "").length >= 32,
    serviceAccountEmail: /^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "").trim()),
    privateKey: Boolean(env.FIREBASE_PRIVATE_KEY),
    projectId: firebaseProjectId(env)
  };
  const step = async (fn) => {
    try {
      return { ok: true, detail: await fn() };
    } catch (error) {
      return { ok: false, detail: String(error.message || error).slice(0, 120) };
    }
  };
  checks.privateKeyReadable = await step(async () => { await serviceAccountKey(env); return "ok"; });
  checks.googleAccessToken = await step(async () => { await googleAccessToken(env); return "ok"; });
  checks.firestore = await step(async () => { await firestoreGet(env, "steamLinks/health-check"); return "ok"; });
  checks.steamOpenId = await step(async () => {
    const response = await fetch(STEAM_OPENID_URL, { headers: { "User-Agent": STEAM_USER_AGENT }, redirect: "manual" });
    return `HTTP ${response.status}`;
  });
  return new Response(JSON.stringify(checks, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function handleSteamAuth(request, requestUrl, env) {
  const origin = request.headers.get("Origin");
  const origins = allowedOrigins(env);
  if (origin && !origins.includes(origin)) {
    return textResponse("This website is not allowed to use Steam sign-in.", 403);
  }
  if (request.method !== "GET") return textResponse("Method not allowed.", 405);
  if (requestUrl.pathname === "/auth/steam/start") return steamLoginStart(requestUrl, env);
  if (requestUrl.pathname === "/auth/steam/health") return steamHealth(request, env);
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
    // 讀庫存已經改由家裡手機的中繼站（relay/relay.mjs）處理，這支 Worker 只剩 Steam 登入
    return jsonResponse({ error: "not_found" }, 404, corsHeaders);
  }
};

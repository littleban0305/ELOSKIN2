const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const firebaseNotice = document.querySelector("#firebase-notice");
const passwordReset = document.querySelector("#password-reset");
const googleAuthButton = document.querySelector("#google-auth");
const steamAuthButton = document.querySelector("#steam-auth");
const avatarFile = document.querySelector("#avatar-file");
const avatarUploadButton = document.querySelector("#avatar-upload");
const avatarStatus = document.querySelector("#avatar-status");
const authTabs = document.querySelectorAll("[data-auth-mode]");
const profileShortcut = document.querySelector("#profile-shortcut");
const loginModal = document.querySelector("#login-modal");
const loginMethods = document.querySelector("#login-methods");
const emailLoginView = document.querySelector("#email-login-view");
const emailLoginBack = document.querySelector("#email-login-back");
const loginModalTitle = document.querySelector("#login-modal-title");
const profileSetupModal = document.querySelector("#profile-setup-modal");
const profileSetupForm = document.querySelector("#profile-setup-form");
const profileSetupStatus = document.querySelector("#profile-setup-status");
const firebaseConfig = window.ELOSKIN_FIREBASE_CONFIG;
const steamAuthConfig = window.ELOSKIN2_STEAM_CONFIG;
const authText = window.eloText;
const ADMIN_EMAIL = "littleban0305@gmail.com";
const steamCallback = (() => {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const token = parameters.get("steam-auth");
  const error = parameters.get("steam-error");
  const linked = parameters.get("steam-linked");
  if (!token && !error && !linked) return null;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "#profile";
  window.history.replaceState(window.history.state, "", cleanUrl.href);
  window.dispatchEvent(new Event("hashchange"));
  return { token, error, linked };
})();
let authMode = "login";
let firebaseAuth = null;
let firebaseDb = null;
let favoriteAuth = null;
let favoriteDb = null;
let favoriteAuthReady = Promise.resolve();
let firebaseReady = false;
let anonymousSignInPromise = null;
const checkedProfileUids = new Set();
let profileSetupUser = null;

function showAuthMessage(message, kind = "error") {
  authStatus.textContent = message;
  authStatus.dataset.kind = kind;
}

window.showAuthMessage = showAuthMessage;

function showSteamLoginError(message) {
  loginMethods.hidden = false;
  emailLoginView.hidden = true;
  emailLoginBack.hidden = true;
  loginModalTitle.textContent = authText("profile.chooseLoginMethod");
  loginModal.hidden = false;
  showAuthMessage(message);
}

function openLoginModal() {
  loginMethods.hidden = false;
  emailLoginView.hidden = true;
  emailLoginBack.hidden = true;
  loginModalTitle.textContent = authText("profile.chooseLoginMethod");
  loginModal.hidden = false;
  showAuthMessage("");
  document.querySelector("#email-login-choice").focus();
}

function openProfilePage() {
  history.pushState(null, "", "#profile");
  window.dispatchEvent(new Event("hashchange"));
}

document.querySelector("#email-login-choice").addEventListener("click", () => {
  loginMethods.hidden = true;
  emailLoginView.hidden = false;
  emailLoginBack.hidden = false;
  loginModalTitle.textContent = authText("profile.emailLoginTitle");
  setAuthMode("login");
  document.querySelector("#email").focus();
});

emailLoginBack.addEventListener("click", () => {
  emailLoginView.hidden = true;
  loginMethods.hidden = false;
  emailLoginBack.hidden = true;
  loginModalTitle.textContent = authText("profile.chooseLoginMethod");
  showAuthMessage("");
  document.querySelector("#email-login-choice").focus();
});

function closeLoginModal() {
  loginModal.hidden = true;
}

document.querySelector("#close-login-modal").addEventListener("click", closeLoginModal);
loginModal.addEventListener("click", (event) => {
  if (event.target === loginModal) closeLoginModal();
});

profileShortcut.addEventListener("click", () => {
  if (window.eloAuthUser) openProfilePage();
  else openLoginModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!loginModal.hidden) closeLoginModal();
});

function showProfileSetup(user, message = "") {
  profileSetupUser = user;
  document.querySelector("#setup-display-name").value = user.displayName || "";
  profileSetupStatus.textContent = message;
  profileSetupStatus.dataset.kind = message ? "error" : "";
  profileSetupModal.hidden = false;
  document.querySelector("#setup-display-name").focus();
}

async function ensureUserProfile(user) {
  if (!user || checkedProfileUids.has(user.uid)) return;
  checkedProfileUids.add(user.uid);
  if (!firebaseDb) {
    showProfileSetup(user, authText("profile.setupFirestoreUnavailable"));
    return;
  }
  try {
    const profile = await firebaseDb.collection("userProfiles").doc(user.uid).get();
    if (firebaseAuth?.currentUser?.uid !== user.uid) return;
    if (!profile.exists) {
      showProfileSetup(user);
      return;
    }
    const data = profile.data();
    window.eloUserProfile = data;
    window.dispatchEvent(new Event("eloprofilechange"));
    fillProfileForm(user, true);
    if (data.displayName && data.displayName !== user.displayName) {
      await user.updateProfile({ displayName: data.displayName });
      updateAccount(user);
    }
  } catch (error) {
    showProfileSetup(user, authText("profile.setupReadError", { message: error.message }));
  }
}

function isValidSteamTradeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "steamcommunity.com"
      && url.pathname === "/tradeoffer/new/"
      && /^\d+$/.test(url.searchParams.get("partner") || "")
      && Boolean(url.searchParams.get("token"));
  } catch {
    return false;
  }
}

profileSetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb || user.uid !== profileSetupUser?.uid) {
    profileSetupStatus.textContent = authText("profile.setupFirestoreUnavailable");
    profileSetupStatus.dataset.kind = "error";
    return;
  }
  const displayName = document.querySelector("#setup-display-name").value.trim();
  const tradeUrl = document.querySelector("#setup-trade-url").value.trim();
  if (!displayName) {
    profileSetupStatus.textContent = authText("profile.setupNameRequired");
    profileSetupStatus.dataset.kind = "error";
    return;
  }
  if (!isValidSteamTradeUrl(tradeUrl)) {
    profileSetupStatus.textContent = authText("profile.setupInvalidTradeUrl");
    profileSetupStatus.dataset.kind = "error";
    return;
  }

  const submit = document.querySelector("#profile-setup-submit");
  submit.disabled = true;
  profileSetupStatus.textContent = authText("profile.setupSaving");
  profileSetupStatus.dataset.kind = "info";
  try {
    await user.updateProfile({ displayName });
    await firebaseDb.collection("userProfiles").doc(user.uid).set({ displayName, tradeUrl });
    window.eloUserProfile = { displayName, tradeUrl };
    window.dispatchEvent(new Event("eloprofilechange"));
    fillProfileForm(user, true);
    profileSetupModal.hidden = true;
    profileSetupStatus.textContent = authText("profile.setupSaved");
    updateAccount(user);
  } catch (error) {
    profileSetupStatus.textContent = authText("profile.setupSaveError", { message: error.message });
    profileSetupStatus.dataset.kind = "error";
  } finally {
    submit.disabled = false;
  }
});

const profileEditForm = document.querySelector("#profile-edit-form");
const profileEditName = document.querySelector("#profile-edit-name");
const profileEditTradeUrl = document.querySelector("#profile-edit-trade-url");
const profileEditStatus = document.querySelector("#profile-edit-status");

function setProfileEditStatus(message, kind = "") {
  profileEditStatus.textContent = message;
  profileEditStatus.dataset.kind = kind;
}

function fillProfileForm(user, force = false) {
  if (!user) return;
  if (!force && profileEditForm.contains(document.activeElement)) return;
  const profile = window.eloUserProfile || {};
  profileEditName.dataset.uid = user.uid;
  profileEditName.value = profile.displayName || user.displayName || "";
  profileEditTradeUrl.value = profile.tradeUrl || "";
}

document.querySelector("#profile-login").addEventListener("click", openLoginModal);

profileEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = firebaseAuth?.currentUser;
  if (!user || !firebaseDb) {
    setProfileEditStatus(authText("profile.setupFirestoreUnavailable"), "error");
    return;
  }
  const displayName = profileEditName.value.trim();
  const tradeUrl = profileEditTradeUrl.value.trim();
  if (!displayName) {
    setProfileEditStatus(authText("profile.setupNameRequired"), "error");
    profileEditName.focus();
    return;
  }
  if (!isValidSteamTradeUrl(tradeUrl)) {
    setProfileEditStatus(authText("profile.setupInvalidTradeUrl"), "error");
    profileEditTradeUrl.focus();
    return;
  }
  const submit = document.querySelector("#profile-edit-submit");
  submit.disabled = true;
  setProfileEditStatus(authText("profile.profileSaving"), "info");
  try {
    await firebaseDb.collection("userProfiles").doc(user.uid).set({ displayName, tradeUrl });
    await user.updateProfile({ displayName });
    window.eloUserProfile = { displayName, tradeUrl };
    window.dispatchEvent(new Event("eloprofilechange"));
    updateAccount(user);
    setProfileEditStatus(authText("profile.profileSaved"), "success");
  } catch (error) {
    setProfileEditStatus(authText("profile.setupSaveError", { message: error.message }), "error");
  } finally {
    submit.disabled = false;
  }
});

function showAvatarMessage(message, kind = "error") {
  avatarStatus.textContent = message;
  avatarStatus.dataset.kind = kind;
  avatarStatus.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  document.querySelector("#login-tab").classList.toggle("active", !registering);
  document.querySelector("#register-tab").classList.toggle("active", registering);
  document.querySelector("#login-tab").setAttribute("aria-selected", String(!registering));
  document.querySelector("#register-tab").setAttribute("aria-selected", String(registering));
  const authTitle = document.querySelector("#auth-title");
  const authSubtitle = document.querySelector("#auth-subtitle");
  if (authTitle) authTitle.textContent = registering ? authText("profile.registerTitle") : authText("profile.loginTitle");
  if (authSubtitle) authSubtitle.textContent = registering ? authText("profile.registerDescription") : authText("profile.loginDescription");
  document.querySelector("#auth-submit").textContent = registering ? authText("profile.createAccount") : authText("profile.login");
  document.querySelector("#confirm-password-field").hidden = !registering;
  document.querySelector("#password").autocomplete = registering ? "new-password" : "current-password";
  document.querySelector("#confirm-password").required = registering;
  passwordReset.hidden = registering;
  showAuthMessage("");
}

authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const showing = input.type === "password";
    input.type = showing ? "text" : "password";
    button.classList.toggle("is-visible", showing);
    button.setAttribute("aria-label", authText(showing ? "profile.hidePassword" : "profile.showPassword"));
    button.setAttribute("aria-pressed", String(showing));
  });
});

function updateAccount(user) {
  if (user?.isAnonymous) user = null;
  window.eloAuthUser = user;
  const steamId = user?.uid?.startsWith("steam:") ? user.uid.slice("steam:".length) : "";
  const savedName = user && window.eloUserProfile?.displayName;
  const name = savedName || user?.displayName || user?.email?.split("@")[0] || (steamId ? `Steam ${steamId}` : authText("profile.guest"));
  const initial = [...name.trim()][0]?.toLocaleUpperCase("zh-Hant") || authText("profile.fallbackInitial");
  const avatarImage = document.querySelector("#profile-avatar-image");
  const avatarInitial = document.querySelector("#profile-avatar-initial");
  let avatarUrl = user?.photoURL || "";
  if (user) {
    try {
      avatarUrl = localStorage.getItem(`eloskin2.avatar.${user.uid}`) || avatarUrl;
    } catch (error) {
      showAvatarMessage(authText("profile.avatarLocalReadError", { message: error.message }));
    }
  }
  document.querySelector("#profile-name").textContent = user ? name : authText("profile.guest");
  document.querySelector("#profile-email").textContent = user?.email || (steamId ? `Steam ID ${steamId}` : authText("profile.guestDescription"));
  avatarInitial.textContent = initial;
  avatarImage.hidden = !avatarUrl;
  avatarInitial.hidden = Boolean(avatarUrl);
  avatarImage.onerror = () => {
    avatarImage.hidden = true;
    avatarInitial.hidden = false;
  };
  if (avatarUrl) avatarImage.src = avatarUrl;
  else avatarImage.removeAttribute("src");
  document.querySelector("#profile-avatar").classList.toggle("signed-in", Boolean(user));
  document.querySelector("#profile-guest").hidden = Boolean(user);
  document.querySelector("#profile-signed-in").hidden = !user;
  const providerId = steamId ? "steam" : user?.providerData?.[0]?.providerId || "";
  document.querySelector("#profile-provider").textContent = !user ? ""
    : providerId === "steam" ? authText("profile.providerSteam")
      : providerId === "google.com" ? authText("profile.providerGoogle") : authText("profile.providerEmail");
  if (user && document.querySelector("#profile-edit-name").dataset.uid !== user.uid) fillProfileForm(user);
  const shortcut = document.querySelector("#profile-shortcut");
  shortcut.replaceChildren();
  shortcut.classList.toggle("has-avatar", Boolean(user && avatarUrl));
  if (user && avatarUrl) {
    const navAvatar = document.createElement("img");
    navAvatar.className = "nav-avatar";
    navAvatar.alt = "";
    navAvatar.referrerPolicy = "no-referrer";
    navAvatar.addEventListener("error", () => {
      shortcut.classList.remove("has-avatar");
      shortcut.textContent = initial;
    });
    navAvatar.src = avatarUrl;
    shortcut.append(navAvatar);
  } else {
    shortcut.textContent = user ? initial : authText("nav.account");
  }
  document.querySelector("#profile-shortcut").setAttribute("aria-label", user ? authText("nav.profileAria") : authText("nav.accountAria"));
  document.querySelector("#profile-shortcut").classList.toggle("signed-in", Boolean(user));
  document.querySelector("#open-cart").hidden = !user;
  document.querySelector("#sign-out").hidden = !user;
  avatarUploadButton.hidden = !user;
  document.querySelector("#auth-form").hidden = Boolean(user);
  document.querySelector(".auth-tabs").hidden = Boolean(user);
  const authTitle = document.querySelector("#auth-title");
  const authSubtitle = document.querySelector("#auth-subtitle");
  if (authTitle) authTitle.textContent = user ? authText("profile.signedInTitle") : authMode === "register" ? authText("profile.registerTitle") : authText("profile.loginTitle");
  if (authSubtitle) authSubtitle.textContent = user ? authText("profile.signedInDescription") : authMode === "register" ? authText("profile.registerDescription") : authText("profile.loginDescription");
  if (user) {
    closeLoginModal();
    ensureUserProfile(user);
  } else {
    profileSetupModal.hidden = true;
    profileSetupUser = null;
    window.eloUserProfile = null;
    window.dispatchEvent(new Event("eloprofilechange"));
    checkedProfileUids.clear();
  }
  const isAdmin = Boolean(user) && user.email?.toLowerCase() === ADMIN_EMAIL;
  window.eloIsAdmin = isAdmin;
  window.dispatchEvent(new CustomEvent("eloauthchange", {
    detail: { user, isAdmin, emailVerified: Boolean(user?.emailVerified) }
  }));
  if (!user) showAvatarMessage("");
}

function loadSiteContent() {
  if (!firebaseDb) {
    window.dispatchEvent(new CustomEvent("listingschange", { detail: { error: "firestore_unavailable" } }));
    return;
  }
  firebaseDb.collection("listings").where("listed", "==", true).onSnapshot((snapshot) => {
    const listings = [];
    snapshot.forEach((document) => listings.push({ id: document.id, ...document.data() }));
    window.eloListings = listings;
    window.dispatchEvent(new CustomEvent("listingschange", { detail: { listings } }));
  }, (error) => {
    console.warn("Listings unavailable:", error);
    window.dispatchEvent(new CustomEvent("listingschange", { detail: { error: error.code || error.message } }));
  });
  firebaseDb.doc("siteSettings/faq").onSnapshot((snapshot) => {
    const items = snapshot.exists ? snapshot.data().items : null;
    const valid = Array.isArray(items) && items.every((item) => item
      && typeof item.question === "string" && typeof item.answer === "string");
    window.eloFaqItems = valid ? items : null;
    window.dispatchEvent(new CustomEvent("faqchange", { detail: { items: window.eloFaqItems, exists: snapshot.exists } }));
  }, (error) => {
    console.warn("FAQ unavailable:", error);
  });
}

function favoriteDocumentId(product) {
  const productKey = product.source === "steam" ? `steam:${product.marketHashName}` : product.id;
  return encodeURIComponent(productKey);
}

function ensureFavoriteUser() {
  if (!favoriteAuth) return Promise.reject(new Error("firebase_auth_unavailable"));
  if (!anonymousSignInPromise) {
    anonymousSignInPromise = favoriteAuthReady.then(() => {
      if (favoriteAuth.currentUser) return favoriteAuth.currentUser;
      return favoriteAuth.signInAnonymously().then((credential) => credential.user);
    })
      .finally(() => { anonymousSignInPromise = null; });
  }
  return anonymousSignInPromise;
}

function installFavoriteFeatures() {
  if (!favoriteDb || !favoriteAuth) return;
  favoriteDb.collection("productFavoriteCounts").onSnapshot((snapshot) => {
    const counts = {};
    snapshot.forEach((document) => {
      const count = document.data().count;
      if (Number.isInteger(count) && count >= 0) counts[document.id] = count;
    });
    window.dispatchEvent(new CustomEvent("favoritecountschanged", { detail: counts }));
  });

  window.eloGetProductFavorite = async (product) => {
    const user = await ensureFavoriteUser();
    const reference = favoriteDb.doc(`productFavorites/${favoriteDocumentId(product)}/voters/${user.uid}`);
    return (await reference.get()).exists;
  };

  window.eloToggleProductFavorite = async (product, shouldFavorite) => {
    const user = await ensureFavoriteUser();
    const productId = favoriteDocumentId(product);
    const countReference = favoriteDb.doc(`productFavoriteCounts/${productId}`);
    const voteReference = favoriteDb.doc(`productFavorites/${productId}/voters/${user.uid}`);
    let count = 0;
    let isFavorite = shouldFavorite;

    await favoriteDb.runTransaction(async (transaction) => {
      const vote = await transaction.get(voteReference);
      const counter = await transaction.get(countReference);
      count = counter.exists ? counter.data().count : 0;
      isFavorite = vote.exists;
      if (vote.exists === shouldFavorite) return;
      if (shouldFavorite) {
        transaction.set(voteReference, { uid: user.uid });
        if (counter.exists) transaction.update(countReference, { count: count + 1 });
        else transaction.set(countReference, { count: 1 });
        count += 1;
        isFavorite = true;
      } else {
        if (!counter.exists || !Number.isInteger(count) || count < 1) {
          throw new Error("favorite_count_invalid");
        }
        transaction.delete(voteReference);
        transaction.update(countReference, { count: count - 1 });
        count -= 1;
        isFavorite = false;
      }
    });
    return { isFavorite, count };
  };
}

function isConfigured(config) {
  return Boolean(config && config.apiKey && config.authDomain && config.projectId && config.appId);
}

function loadFirebaseScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.onload = resolve;
    script.onerror = () => reject(new Error(authText("profile.firebaseSdkError", { source })));
    document.head.append(script);
  });
}

async function initializeFirebase() {
  if (!isConfigured(firebaseConfig)) {
    firebaseNotice.textContent = authText("profile.firebaseMissing");
    firebaseNotice.hidden = false;
    if (steamCallback) showSteamLoginError(authText("profile.firebaseMissing"));
    window.dispatchEvent(new CustomEvent("listingschange", { detail: { error: "firebase_not_configured" } }));
    return;
  }

  firebaseNotice.hidden = true;
  try {
    const version = "10.14.1";
    await loadFirebaseScript(`https://www.gstatic.com/firebasejs/${version}/firebase-app-compat.js`);
    await loadFirebaseScript(`https://www.gstatic.com/firebasejs/${version}/firebase-auth-compat.js`);
    const firebase = window.firebase;
    if (!firebase) throw new Error(authText("profile.firebaseMissingObject"));
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    try {
      await loadFirebaseScript(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore-compat.js`);
      firebaseDb = firebase.firestore();
      const favoriteApp = firebase.apps.find((app) => app.name === "ELOSKIN2_FAVORITES")
        || firebase.initializeApp(firebaseConfig, "ELOSKIN2_FAVORITES");
      favoriteAuth = favoriteApp.auth();
      favoriteDb = favoriteApp.firestore();
      favoriteAuthReady = favoriteAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .catch(() => {})
        .then(() => new Promise((resolve) => {
          const unsubscribe = favoriteAuth.onAuthStateChanged(() => {
            unsubscribe();
            resolve();
          }, () => {
            unsubscribe();
            resolve();
          });
        }));
    } catch (error) {
      console.warn("Firestore unavailable:", error);
    }
    firebaseAuth.onAuthStateChanged(updateAccount, (error) => {
      const message = authText("profile.firebaseStateError", { message: error.message });
      if (steamCallback) showSteamLoginError(message);
      else showAuthMessage(message);
    });
    // Google 綁定被擋彈出視窗時會改用整頁跳轉，回來時在這裡收結果
    Promise.resolve(firebaseAuth.getRedirectResult?.()).then((result) => {
      if (result?.operationType === "link") afterLinkChange(authText("profile.linkDone", { name: authText("profile.linkGoogle") }));
    }).catch((error) => showLinkStatus(linkErrorMessage(error, authText("profile.linkGoogle")), "error"));
    firebaseReady = true;
    window.eloFirebaseAuth = firebaseAuth;
    window.eloFirebaseDb = firebaseDb;
    window.dispatchEvent(new Event("elofirebaseready"));
    loadSiteContent();
    installFavoriteFeatures();
    await completeSteamSignIn();
  } catch (error) {
    firebaseNotice.hidden = false;
    firebaseNotice.textContent = authText("profile.firebaseInitError", { message: error.message });
    window.dispatchEvent(new CustomEvent("listingschange", { detail: { error: "firebase_init_failed" } }));
    const message = authText("profile.firebaseInitError", { message: error.message });
    if (steamCallback) showSteamLoginError(message);
    else showAuthMessage(message);
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseReady || !firebaseAuth) {
    showAuthMessage(authText("profile.configureFirebase"));
    return;
  }

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const confirmPassword = document.querySelector("#confirm-password").value;
  if (authMode === "register" && password !== confirmPassword) {
    showAuthMessage(authText("profile.passwordMismatch"));
    return;
  }

  const submit = document.querySelector("#auth-submit");
  const isLogin = authMode === "login";
  submit.disabled = true;
  googleAuthButton.disabled = true;
  showAuthMessage(isLogin ? authText("profile.loggingIn") : authText("profile.creatingAccount"), "info");
  try {
    if (!isLogin) {
      await firebaseAuth.createUserWithEmailAndPassword(email, password);
    } else {
      try {
        await firebaseAuth.signInWithEmailAndPassword(email, password);
      } catch (error) {
        if (!["auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found"].includes(error.code)) throw error;
        showAuthMessage(authText("profile.autoRegistering"), "info");
        await firebaseAuth.createUserWithEmailAndPassword(email, password);
        showAuthMessage(authText("profile.autoRegistered"), "success");
      }
    }
  } catch (error) {
    const messages = {
      "auth/invalid-credential": authText("profile.invalidCredential"),
      "auth/invalid-login-credentials": authText("profile.invalidCredential"),
      "auth/wrong-password": authText("profile.invalidCredential"),
      "auth/user-not-found": authText("profile.invalidCredential"),
      "auth/invalid-email": authText("profile.invalidEmail"),
      "auth/user-disabled": authText("profile.userDisabled"),
      "auth/too-many-requests": authText("profile.tooManyRequests"),
      "auth/network-request-failed": authText("profile.networkError"),
      "auth/email-already-in-use": authText("profile.emailInUse"),
      "auth/weak-password": authText("profile.weakPassword"),
      "auth/operation-not-allowed": authText("profile.emailPasswordProviderDisabled")
    };
    const message = error.code === "auth/email-already-in-use"
      ? authText(isLogin ? "profile.invalidCredential" : "profile.emailInUse")
      : messages[error.code] || authText("profile.authError", {
        code: error.code || "unknown",
        message: error.message
      });
    showAuthMessage(message);
  } finally {
    submit.disabled = false;
    googleAuthButton.disabled = false;
  }
});

googleAuthButton.addEventListener("click", async () => {
  if (!firebaseReady || !firebaseAuth) {
    showAuthMessage(authText("profile.configureFirebase"));
    return;
  }

  googleAuthButton.disabled = true;
  document.querySelector("#auth-submit").disabled = true;
  showAuthMessage(authText("profile.googleLoginProgress"), "info");
  try {
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    const messages = {
      "auth/operation-not-allowed": authText("profile.googleProviderDisabled"),
      "auth/popup-closed-by-user": authText("profile.googleLoginCancelled"),
      "auth/cancelled-popup-request": authText("profile.googleLoginCancelled"),
      "auth/popup-blocked": authText("profile.googlePopupBlocked"),
      "auth/unauthorized-domain": authText("profile.googleDomainNotAuthorized"),
      "auth/account-exists-with-different-credential": authText("profile.googleAccountConflict")
    };
    showAuthMessage(messages[error.code] || authText("profile.authError", {
      code: error.code || "unknown",
      message: error.message
    }));
  } finally {
    googleAuthButton.disabled = false;
    document.querySelector("#auth-submit").disabled = false;
  }
});

steamAuthButton.addEventListener("click", () => {
  if (!firebaseReady || !firebaseAuth) {
    showAuthMessage(authText("profile.configureFirebase"));
    return;
  }

  try {
    const endpoint = new URL(steamAuthConfig?.authEndpoint || "");
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
      throw new Error(authText("profile.steamLoginNotConfigured"));
    }
    endpoint.pathname = "/auth/steam/start";
    endpoint.search = "";
    endpoint.searchParams.set("returnUrl", `${window.location.origin}${window.location.pathname}${window.location.search}`);
    steamAuthButton.disabled = true;
    googleAuthButton.disabled = true;
    document.querySelector("#auth-submit").disabled = true;
    showAuthMessage(authText("profile.steamLoginProgress"), "info");
    window.location.assign(endpoint.href);
  } catch (error) {
    steamAuthButton.disabled = false;
    googleAuthButton.disabled = false;
    document.querySelector("#auth-submit").disabled = false;
    showAuthMessage(error.message || authText("profile.steamLoginNotConfigured"));
  }
});

function steamErrorMessage(rawCode) {
  const [code, detail = ""] = String(rawCode || "").split(":");
  const messages = {
    "not-configured": "profile.steamLoginNotConfigured",
    cancelled: "profile.steamLoginCancelled",
    "verification-failed": "profile.steamLoginVerificationFailed",
    "service-unavailable": "profile.steamLoginUnavailable",
    "steam-verification-unavailable": "profile.steamVerificationUnavailable",
    "steam-verification-network-error": "profile.steamVerificationNetworkError",
    "steam-verification-response-error": "profile.steamVerificationResponseError",
    "firebase-token-failed": "profile.steamFirebaseTokenFailed",
    "link-session-invalid": "profile.steamLinkSessionInvalid",
    "link-already-steam": "profile.steamLinkAlreadySteam",
    "link-steam-taken": "profile.steamLinkTaken",
    "link-steam-has-account": "profile.steamLinkHasAccount",
    "link-failed": "profile.steamLinkFailed",
    "link-lookup-failed": "profile.steamLinkLookupFailed"
  };
  const httpError = /^steam-verification-http-(\d{3})$/.exec(code);
  const message = httpError
    ? authText("profile.steamVerificationHttpError", { status: httpError[1] })
    : authText(messages[code] || "profile.steamLoginVerificationFailed");
  // 錯誤代碼一起顯示，回報問題時直接截圖就好
  return authText("profile.steamErrorDetail", { message, code: detail ? `${code}:${detail}` : code });
}

async function completeSteamSignIn() {
  if (!steamCallback) return;
  if (steamCallback.linked) {
    window.dispatchEvent(new Event("eloaccountlinkschange"));
    showLinkStatus(authText("profile.steamLinked"), "success");
    return;
  }
  if (steamCallback.error) {
    const message = steamErrorMessage(steamCallback.error);
    if (steamCallback.error.startsWith("link-")) showLinkStatus(message, "error");
    else showSteamLoginError(message);
    return;
  }
  if (!steamCallback.token) {
    showSteamLoginError(authText("profile.steamLoginVerificationFailed"));
    return;
  }

  try {
    const credential = await firebaseAuth.signInWithCustomToken(steamCallback.token);
    // 綁定過的 Steam 會登入原本的帳號（uid 不是 steam: 開頭），這時不要用 Steam 名稱蓋掉原本的資料
    const steamId = credential.user.uid.startsWith("steam:") ? credential.user.uid.slice("steam:".length) : "";
    if (steamId && steamAuthConfig?.authEndpoint) await loadSteamProfile(credential.user, steamId);
  } catch (error) {
    showSteamLoginError(authText("profile.steamLoginFirebaseFailed", {
      message: `${error.code || "unknown"}: ${error.message}`
    }));
  }
}

async function loadSteamProfile(user, steamId) {
  try {
    const profileEndpoint = new URL("/auth/steam/profile", steamAuthConfig.authEndpoint);
    profileEndpoint.searchParams.set("steamId", steamId);
    const response = await fetch(profileEndpoint);
    if (!response.ok) throw new Error(authText("profile.steamProfileError"));
    const profile = await response.json();
    const updates = {};
    if (profile.displayName) updates.displayName = profile.displayName;
    if (profile.photoURL) updates.photoURL = profile.photoURL;
    if (Object.keys(updates).length) {
      await user.updateProfile(updates);
      updateAccount(user);
    }
  } catch (error) {
    showAvatarMessage(authText("profile.steamProfileError"), "error");
  }
}

avatarUploadButton.addEventListener("click", () => avatarFile.click());

avatarFile.addEventListener("change", async () => {
  const file = avatarFile.files?.[0];
  if (!file) {
    showAvatarMessage(authText("profile.avatarChooseFile"));
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    showAvatarMessage(authText("profile.avatarInvalidType"));
    avatarFile.value = "";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showAvatarMessage(authText("profile.avatarTooLarge"));
    avatarFile.value = "";
    return;
  }
  if (!firebaseAuth?.currentUser) {
    showAvatarMessage(authText("profile.configureFirebase"));
    avatarFile.value = "";
    return;
  }

  avatarUploadButton.disabled = true;
  showAvatarMessage(authText("profile.avatarUploading"), "info");
  try {
    const user = firebaseAuth.currentUser;
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      image.close();
      throw new Error(authText("profile.avatarCanvasUnavailable"));
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const avatarData = canvas.toDataURL("image/jpeg", 0.85);
    localStorage.setItem(`eloskin2.avatar.${user.uid}`, avatarData);
    updateAccount(user);
    showAvatarMessage(authText("profile.avatarUploadSuccess"), "success");
  } catch (error) {
    showAvatarMessage(authText("profile.avatarLocalSaveError", { message: error.message }));
  } finally {
    avatarUploadButton.disabled = false;
    avatarFile.value = "";
  }
});

passwordReset.addEventListener("click", async () => {
  if (!firebaseReady || !firebaseAuth) {
    showAuthMessage(authText("profile.configureFirebase"));
    return;
  }

  const email = document.querySelector("#email").value.trim();
  if (!email) {
    showAuthMessage(authText("profile.enterEmailForReset"));
    document.querySelector("#email").focus();
    return;
  }

  passwordReset.disabled = true;
  showAuthMessage(authText("profile.passwordResetSending"), "info");
  try {
    await firebaseAuth.sendPasswordResetEmail(email);
    showAuthMessage(authText("profile.passwordResetSent"), "success");
  } catch (error) {
    const message = error.code === "auth/invalid-email"
      ? authText("profile.invalidEmail")
      : error.message;
    showAuthMessage(authText("profile.passwordResetError", { message }));
  } finally {
    passwordReset.disabled = false;
  }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  if (!firebaseAuth) return;
  try {
    await firebaseAuth.signOut();
    showAuthMessage(authText("profile.signOutSuccess"), "success");
  } catch (error) {
    showAuthMessage(authText("profile.signOutError", { message: error.message }));
  }
});

initializeFirebase();


// ---------- 帳號綁定：Google、電子郵件、Steam ----------

const linkStatus = document.querySelector("#account-links-status");
let accountSteamLink = "";
let unlinkArmed = "";

function showLinkStatus(message, kind = "") {
  linkStatus.textContent = message;
  linkStatus.dataset.kind = kind;
}

function linkedProviders(user) {
  const providers = new Set((user?.providerData || []).map((entry) => entry?.providerId));
  return {
    google: (user?.providerData || []).find((entry) => entry?.providerId === "google.com"),
    password: (user?.providerData || []).find((entry) => entry?.providerId === "password"),
    steamPrimary: Boolean(user?.uid?.startsWith("steam:")),
    count: providers.has("google.com") + providers.has("password") + (user?.uid?.startsWith("steam:") || accountSteamLink ? 1 : 0)
  };
}

async function loadAccountSteamLink(user) {
  accountSteamLink = "";
  if (!user || user.uid.startsWith("steam:") || !firebaseDb) return;
  try {
    const snapshot = await firebaseDb.collection("accountLinks").doc(user.uid).get();
    accountSteamLink = String(snapshot.data()?.steamId || "");
  } catch (error) {
    console.warn("Account links unavailable:", error);
  }
}

function renderAccountLinks() {
  const user = firebaseAuth?.currentUser;
  const card = document.querySelector("#account-links-card");
  if (!card) return;
  card.hidden = !user || user.isAnonymous;
  if (card.hidden) return;
  const linked = linkedProviders(user);
  const setRow = (key, value, isLinked, canUnlink) => {
    document.querySelector(`#link-${key}-value`).textContent = value;
    document.querySelector(`#link-${key}-value`).dataset.linked = String(isLinked);
    const button = document.querySelector(`#link-${key}-button`);
    button.hidden = isLinked && !canUnlink && key === "steam" && linked.steamPrimary;
    button.dataset.action = isLinked ? "unlink" : "link";
    button.textContent = authText(isLinked ? (unlinkArmed === key ? "profile.unlinkConfirm" : "profile.unlinkButton") : "profile.linkButton");
    button.disabled = isLinked && !canUnlink;
    button.title = isLinked && !canUnlink ? authText("profile.linkLastMethod") : "";
  };
  const canUnlink = linked.count > 1;
  setRow("google", linked.google ? (linked.google.email || "Google") : authText("profile.linkNone"), Boolean(linked.google), canUnlink);
  setRow("password", linked.password ? (linked.password.email || user.email || "") : authText("profile.linkNone"), Boolean(linked.password), canUnlink);
  const steamId = linked.steamPrimary ? user.uid.slice("steam:".length) : accountSteamLink;
  setRow(
    "steam",
    steamId ? authText(linked.steamPrimary ? "profile.linkSteamPrimary" : "profile.linkSteamValue", { id: steamId }) : authText("profile.linkNone"),
    Boolean(steamId),
    canUnlink && !linked.steamPrimary
  );
}

function linkErrorMessage(error, name) {
  const messages = {
    "auth/credential-already-in-use": authText("profile.linkCredentialInUse", { name }),
    "auth/email-already-in-use": authText("profile.linkEmailInUse"),
    "auth/weak-password": authText("profile.linkWeakPassword"),
    "auth/requires-recent-login": authText("profile.linkRecentLogin"),
    "auth/popup-closed-by-user": authText("profile.googleLoginCancelled"),
    "auth/cancelled-popup-request": authText("profile.googleLoginCancelled")
  };
  return messages[error.code] || authText("profile.linkError", { message: `${error.code || "unknown"}: ${error.message}` });
}

async function afterLinkChange(message) {
  const user = firebaseAuth.currentUser;
  await user.reload().catch(() => {});
  await loadAccountSteamLink(firebaseAuth.currentUser);
  unlinkArmed = "";
  renderAccountLinks();
  updateAccount(firebaseAuth.currentUser);
  showLinkStatus(message, "success");
}

async function unlinkMethod(key) {
  const user = firebaseAuth.currentUser;
  const names = { google: authText("profile.linkGoogle"), password: authText("profile.linkEmail"), steam: authText("profile.linkSteam") };
  if (unlinkArmed !== key) {
    unlinkArmed = key;
    renderAccountLinks();
    return;
  }
  showLinkStatus(authText("profile.linkWorking"), "info");
  try {
    if (key === "steam") {
      await firebaseDb.collection("steamLinks").doc(accountSteamLink).delete();
      await firebaseDb.collection("accountLinks").doc(user.uid).delete();
    } else {
      await user.unlink(key === "google" ? "google.com" : "password");
    }
    await afterLinkChange(authText("profile.unlinkDone", { name: names[key] }));
  } catch (error) {
    unlinkArmed = "";
    renderAccountLinks();
    showLinkStatus(linkErrorMessage(error, names[key]), "error");
  }
}

document.querySelector("#link-google-button").addEventListener("click", async (event) => {
  if (event.currentTarget.dataset.action === "unlink") return unlinkMethod("google");
  const user = firebaseAuth?.currentUser;
  if (!user) return;
  const provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  showLinkStatus(authText("profile.linkWorking"), "info");
  try {
    await user.linkWithPopup(provider);
    await afterLinkChange(authText("profile.linkDone", { name: authText("profile.linkGoogle") }));
  } catch (error) {
    if (error.code === "auth/popup-blocked") {
      showLinkStatus(authText("profile.linkPopupBlocked"), "info");
      await user.linkWithRedirect(provider);
      return;
    }
    showLinkStatus(linkErrorMessage(error, authText("profile.linkGoogle")), "error");
  }
});

document.querySelector("#link-password-button").addEventListener("click", (event) => {
  if (event.currentTarget.dataset.action === "unlink") return unlinkMethod("password");
  const user = firebaseAuth?.currentUser;
  if (!user) return;
  const form = document.querySelector("#link-email-form");
  const emailInput = document.querySelector("#link-email-address");
  emailInput.value = user.email || "";
  emailInput.readOnly = Boolean(user.email);
  form.hidden = false;
  (user.email ? document.querySelector("#link-email-password") : emailInput).focus();
});

document.querySelector("#link-email-cancel").addEventListener("click", () => {
  document.querySelector("#link-email-form").hidden = true;
});

document.querySelector("#link-email-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = firebaseAuth?.currentUser;
  if (!user) return;
  const email = document.querySelector("#link-email-address").value.trim();
  const password = document.querySelector("#link-email-password").value;
  if (password.length < 6) {
    showLinkStatus(authText("profile.linkWeakPassword"), "error");
    return;
  }
  showLinkStatus(authText("profile.linkWorking"), "info");
  try {
    const credential = window.firebase.auth.EmailAuthProvider.credential(email, password);
    await user.linkWithCredential(credential);
    document.querySelector("#link-email-form").hidden = true;
    document.querySelector("#link-email-password").value = "";
    // 新綁定的電子郵件要驗證過才算數（管理員判斷也會看這個）
    if (!user.emailVerified) await user.sendEmailVerification().catch(() => {});
    await afterLinkChange(authText("profile.linkDone", { name: authText("profile.linkEmail") }));
  } catch (error) {
    showLinkStatus(linkErrorMessage(error, authText("profile.linkEmail")), "error");
  }
});

document.querySelector("#link-steam-button").addEventListener("click", async (event) => {
  if (event.currentTarget.dataset.action === "unlink") return unlinkMethod("steam");
  const user = firebaseAuth?.currentUser;
  if (!user) return;
  try {
    const endpoint = new URL("/auth/steam/start", steamAuthConfig?.authEndpoint || "");
    endpoint.searchParams.set("returnUrl", `${window.location.origin}${window.location.pathname}${window.location.search}`);
    endpoint.searchParams.set("mode", "link");
    endpoint.searchParams.set("idToken", await user.getIdToken(true));
    showLinkStatus(authText("profile.steamLoginProgress"), "info");
    window.location.assign(endpoint.href);
  } catch (error) {
    showLinkStatus(linkErrorMessage(error, authText("profile.linkSteam")), "error");
  }
});

window.addEventListener("eloauthchange", async () => {
  unlinkArmed = "";
  await loadAccountSteamLink(firebaseAuth?.currentUser);
  renderAccountLinks();
});
window.addEventListener("eloaccountlinkschange", async () => {
  await loadAccountSteamLink(firebaseAuth?.currentUser);
  renderAccountLinks();
});

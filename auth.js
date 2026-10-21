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
  if (!token && !error) return null;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "#profile";
  window.history.replaceState(window.history.state, "", cleanUrl.href);
  window.dispatchEvent(new Event("hashchange"));
  return { token, error };
})();
let authMode = "login";
let firebaseAuth = null;
let firebaseDb = null;
let favoriteAuth = null;
let favoriteDb = null;
let favoriteAuthReady = Promise.resolve();
let firebaseReady = false;
let anonymousSignInPromise = null;
let catalogVisibilityReady = false;
let catalogVisibilityError = "";
const hiddenProductIds = new Set();
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
  const name = user?.displayName || user?.email?.split("@")[0] || (steamId ? `Steam ${steamId}` : authText("profile.guest"));
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
  document.querySelector("#profile-shortcut").textContent = user ? initial : authText("nav.account");
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
  }
  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
  const adminPanel = document.querySelector("#admin-panel");
  adminPanel.hidden = !isAdmin;
  document.querySelector("#admin-verify-email").hidden = !isAdmin || user.emailVerified;
  if (isAdmin) renderAdminProductManager(user);
  if (!user) showAvatarMessage("");
}

function setCatalogStatus(message, kind = "") {
  const status = document.querySelector("#admin-catalog-status");
  status.textContent = message;
  status.dataset.kind = kind;
}

function renderAdminProductManager(user) {
  const list = document.querySelector("#admin-product-list");
  const search = document.querySelector("#admin-product-search").value.trim().toLocaleLowerCase("zh-Hant");
  if (!user.emailVerified) {
    setCatalogStatus(authText("profile.adminEmailUnverified"), "error");
    list.replaceChildren();
    return;
  }
  if (catalogVisibilityError) {
    setCatalogStatus(authText("profile.adminStatusError", { message: catalogVisibilityError }), "error");
    list.replaceChildren();
    return;
  }
  if (!catalogVisibilityReady) {
    setCatalogStatus(authText("profile.adminStatusLoading"), "info");
    list.replaceChildren();
    return;
  }

  setCatalogStatus("");
  const products = (window.eloProductCatalog || [])
    .filter((product) => `${product.name} ${product.game} ${product.category}`.toLocaleLowerCase("zh-Hant").includes(search))
    .slice(0, 100);
  list.replaceChildren();
  if (!products.length) {
    setCatalogStatus(authText("profile.adminNoProducts"), "info");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const product of products) {
    const visibilityId = window.eloProductVisibilityId(product);
    const hidden = hiddenProductIds.has(visibilityId);
    const row = document.createElement("div");
    row.className = "admin-product-row";
    const details = document.createElement("div");
    details.className = "admin-product-details";
    const name = document.createElement("strong");
    name.textContent = product.name;
    const metadata = document.createElement("span");
    metadata.textContent = `${product.game} · ${product.category} · ${hidden ? authText("profile.adminUnlisted") : authText("profile.adminListed")}`;
    details.append(name, metadata);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-toggle-button";
    button.dataset.productVisibility = visibilityId;
    button.textContent = hidden ? authText("profile.adminPublish") : authText("profile.adminTakeDown");
    row.append(details, button);
    fragment.append(row);
  }
  list.append(fragment);
  if ((window.eloProductCatalog || []).filter((product) => `${product.name} ${product.game} ${product.category}`.toLocaleLowerCase("zh-Hant").includes(search)).length > 100) {
    setCatalogStatus(authText("profile.adminShowingLimit"), "info");
  }
}

function loadCatalogVisibility() {
  if (!firebaseDb) {
    catalogVisibilityReady = true;
    catalogVisibilityError = authText("profile.adminNotConfigured");
    window.dispatchEvent(new Event("catalogvisibilitychange"));
    return;
  }
  try {
    firebaseDb.doc("siteSettings/catalog").onSnapshot((snapshot) => {
      const ids = snapshot.exists ? snapshot.data().hiddenProductIds : [];
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        catalogVisibilityError = "catalog_visibility_invalid";
      } else {
        hiddenProductIds.clear();
        ids.forEach((id) => hiddenProductIds.add(id));
        catalogVisibilityError = "";
        window.eloHiddenProductIds = new Set(hiddenProductIds);
      }
      catalogVisibilityReady = true;
      window.dispatchEvent(new Event("catalogvisibilitychange"));
    }, (error) => {
      catalogVisibilityReady = true;
      catalogVisibilityError = ["unavailable", "permission-denied", "failed-precondition"].includes(error.code)
        ? authText("profile.adminNotConfigured")
        : error.message;
      window.dispatchEvent(new Event("catalogvisibilitychange"));
      if (window.eloAuthUser?.email?.toLowerCase() === ADMIN_EMAIL) {
        setCatalogStatus(authText("profile.adminStatusError", { message: catalogVisibilityError }), "error");
      }
    });
  } catch (error) {
    catalogVisibilityReady = true;
    catalogVisibilityError = error.message;
    window.dispatchEvent(new Event("catalogvisibilitychange"));
    if (window.eloAuthUser?.email?.toLowerCase() === ADMIN_EMAIL) {
      setCatalogStatus(authText("profile.adminStatusError", { message: catalogVisibilityError }), "error");
    }
  }
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

    await firebaseDb.runTransaction(async (transaction) => {
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

async function updateProductVisibility(visibilityId) {
  if (!firebaseDb || !catalogVisibilityReady || catalogVisibilityError) {
    setCatalogStatus(authText("profile.adminNotConfigured"), "error");
    return;
  }
  const buttons = document.querySelectorAll("[data-product-visibility]");
  buttons.forEach((button) => { button.disabled = true; });
  setCatalogStatus(authText("profile.adminSaving"), "info");
  try {
    const reference = firebaseDb.doc("siteSettings/catalog");
    const nextIds = await firebaseDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const currentIds = snapshot.exists ? snapshot.data().hiddenProductIds || [] : [];
      if (!Array.isArray(currentIds) || currentIds.some((id) => typeof id !== "string")) {
        throw new Error("catalog_visibility_invalid");
      }
      const next = new Set(currentIds);
      if (next.has(visibilityId)) next.delete(visibilityId);
      else {
        if (next.size >= 2000) throw new Error("catalog_visibility_limit_reached");
        next.add(visibilityId);
      }
      transaction.set(reference, { hiddenProductIds: [...next] });
      return [...next];
    });
    hiddenProductIds.clear();
    nextIds.forEach((id) => hiddenProductIds.add(id));
    window.eloHiddenProductIds = new Set(hiddenProductIds);
    setCatalogStatus("");
    window.dispatchEvent(new Event("catalogvisibilitychange"));
  } catch (error) {
    const message = error.message === "catalog_visibility_limit_reached"
      ? authText("profile.adminCatalogLimitReached")
      : error.message === "catalog_visibility_invalid"
        ? authText("profile.adminCatalogDataInvalid")
        : authText("profile.adminSaveError", { message: error.message });
    setCatalogStatus(message, "error");
    buttons.forEach((button) => { button.disabled = false; });
    return;
  }
  renderAdminProductManager(firebaseAuth.currentUser);
}

document.querySelector("#admin-product-search").addEventListener("input", () => {
  if (firebaseAuth?.currentUser) renderAdminProductManager(firebaseAuth.currentUser);
});

document.querySelector("#admin-product-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-product-visibility]");
  if (button) updateProductVisibility(button.dataset.productVisibility);
});

document.querySelector("#admin-verify-email").addEventListener("click", async () => {
  try {
    await firebaseAuth.currentUser.sendEmailVerification();
    setCatalogStatus(authText("profile.adminVerificationSent"), "success");
  } catch (error) {
    setCatalogStatus(authText("profile.adminVerificationError", { message: error.message }), "error");
  }
});

window.addEventListener("catalogvisibilitychange", () => {
  if (firebaseAuth?.currentUser?.email?.toLowerCase() === ADMIN_EMAIL) renderAdminProductManager(firebaseAuth.currentUser);
});
window.addEventListener("catalogproductschange", () => {
  if (firebaseAuth?.currentUser?.email?.toLowerCase() === ADMIN_EMAIL) renderAdminProductManager(firebaseAuth.currentUser);
});

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
      catalogVisibilityError = error.message;
    }
    firebaseAuth.onAuthStateChanged(updateAccount, (error) => {
      const message = authText("profile.firebaseStateError", { message: error.message });
      if (steamCallback) showSteamLoginError(message);
      else showAuthMessage(message);
    });
    firebaseReady = true;
    loadCatalogVisibility();
    installFavoriteFeatures();
    await completeSteamSignIn();
  } catch (error) {
    firebaseNotice.hidden = false;
    firebaseNotice.textContent = authText("profile.firebaseInitError", { message: error.message });
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

async function completeSteamSignIn() {
  if (!steamCallback) return;
  if (steamCallback.error) {
    const messages = {
      "not-configured": "profile.steamLoginNotConfigured",
      cancelled: "profile.steamLoginCancelled",
      "verification-failed": "profile.steamLoginVerificationFailed",
      "service-unavailable": "profile.steamLoginUnavailable",
      "steam-verification-unavailable": "profile.steamVerificationUnavailable",
      "firebase-token-failed": "profile.steamFirebaseTokenFailed"
    };
    showSteamLoginError(authText(messages[steamCallback.error] || "profile.steamLoginVerificationFailed"));
    return;
  }
  if (!steamCallback.token) {
    showSteamLoginError(authText("profile.steamLoginVerificationFailed"));
    return;
  }

  try {
    const credential = await firebaseAuth.signInWithCustomToken(steamCallback.token);
    const steamId = credential.user.uid.startsWith("steam:")
      ? credential.user.uid.slice("steam:".length)
      : "";
    if (!steamId) {
      showSteamLoginError(authText("profile.steamLoginVerificationFailed"));
      return;
    }
    if (!steamAuthConfig?.authEndpoint) {
      showSteamLoginError(authText("profile.steamLoginNotConfigured"));
      return;
    }
    await loadSteamProfile(credential.user, steamId);
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

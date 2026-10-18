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
const firebaseConfig = window.ELOSKIN_FIREBASE_CONFIG;
const steamAuthConfig = window.ELOSKIN2_STEAM_CONFIG;
const authText = window.eloText;
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
let firebaseReady = false;

function showAuthMessage(message, kind = "error") {
  authStatus.textContent = message;
  authStatus.dataset.kind = kind;
}

window.showAuthMessage = showAuthMessage;

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
  document.querySelector("#auth-title").textContent = registering ? authText("profile.registerTitle") : authText("profile.loginTitle");
  document.querySelector("#auth-subtitle").textContent = registering ? authText("profile.registerDescription") : authText("profile.loginDescription");
  document.querySelector("#auth-submit").textContent = registering ? authText("profile.createAccount") : authText("profile.login");
  document.querySelector("#display-name-field").hidden = !registering;
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
    button.textContent = authText(showing ? "profile.hidePassword" : "profile.showPassword");
    button.setAttribute("aria-label", authText(showing ? "profile.hidePassword" : "profile.showPassword"));
    button.setAttribute("aria-pressed", String(showing));
  });
});

function updateAccount(user) {
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
  document.querySelector("#ec-balance-wrapper").hidden = !user;
  document.querySelector("#sign-out").hidden = !user;
  avatarUploadButton.hidden = !user;
  document.querySelector("#auth-form").hidden = Boolean(user);
  document.querySelector(".auth-tabs").hidden = Boolean(user);
  document.querySelector(".auth-privacy").hidden = Boolean(user);
  document.querySelector("#auth-title").textContent = user ? authText("profile.signedInTitle") : authMode === "register" ? authText("profile.registerTitle") : authText("profile.loginTitle");
  document.querySelector("#auth-subtitle").textContent = user ? authText("profile.signedInDescription") : authMode === "register" ? authText("profile.registerDescription") : authText("profile.loginDescription");
  if (!user) showAvatarMessage("");
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
    firebaseAuth.onAuthStateChanged(updateAccount, (error) => {
      showAuthMessage(authText("profile.firebaseStateError", { message: error.message }));
    });
    firebaseReady = true;
    await completeSteamSignIn();
  } catch (error) {
    firebaseNotice.hidden = false;
    firebaseNotice.textContent = authText("profile.firebaseInitError", { message: error.message });
    showAuthMessage(authText("profile.firebaseInitError", { message: error.message }));
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
  const displayName = document.querySelector("#display-name").value.trim();
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
      const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
      if (displayName) await credential.user.updateProfile({ displayName });
    } else {
      try {
        await firebaseAuth.signInWithEmailAndPassword(email, password);
      } catch (error) {
        if (error.code !== "auth/invalid-credential" && error.code !== "auth/user-not-found") throw error;
        showAuthMessage(authText("profile.autoRegistering"), "info");
        await firebaseAuth.createUserWithEmailAndPassword(email, password);
        showAuthMessage(authText("profile.autoRegistered"), "success");
      }
    }
  } catch (error) {
    const messages = {
      "auth/invalid-credential": authText("profile.invalidCredential"),
      "auth/wrong-password": authText("profile.invalidCredential"),
      "auth/user-not-found": authText("profile.invalidCredential"),
      "auth/invalid-email": authText("profile.invalidEmail"),
      "auth/user-disabled": authText("profile.userDisabled"),
      "auth/too-many-requests": authText("profile.tooManyRequests"),
      "auth/network-request-failed": authText("profile.networkError"),
      "auth/email-already-in-use": authText("profile.emailInUse"),
      "auth/weak-password": authText("profile.weakPassword")
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
      "service-unavailable": "profile.steamLoginUnavailable"
    };
    showAuthMessage(authText(messages[steamCallback.error] || "profile.steamLoginVerificationFailed"));
    return;
  }
  if (!steamCallback.token) {
    showAuthMessage(authText("profile.steamLoginVerificationFailed"));
    return;
  }

  try {
    const credential = await firebaseAuth.signInWithCustomToken(steamCallback.token);
    const steamId = credential.user.uid.startsWith("steam:")
      ? credential.user.uid.slice("steam:".length)
      : "";
    if (!steamId || !steamAuthConfig?.authEndpoint) return;
    await loadSteamProfile(credential.user, steamId);
  } catch (error) {
    showAuthMessage(authText("profile.steamLoginFirebaseFailed", { message: error.message }));
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

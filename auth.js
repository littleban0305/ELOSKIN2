const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const firebaseNotice = document.querySelector("#firebase-notice");
const passwordReset = document.querySelector("#password-reset");
const googleAuthButton = document.querySelector("#google-auth");
const authTabs = document.querySelectorAll("[data-auth-mode]");
const firebaseConfig = window.ELOSKIN_FIREBASE_CONFIG;
const authText = window.eloText;
let authMode = "login";
let firebaseAuth = null;
let firebaseReady = false;

function showAuthMessage(message, kind = "error") {
  authStatus.textContent = message;
  authStatus.dataset.kind = kind;
}

window.showAuthMessage = showAuthMessage;

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
  const name = user?.displayName || user?.email?.split("@")[0] || authText("profile.guest");
  const initial = [...name.trim()][0]?.toLocaleUpperCase("zh-Hant") || authText("profile.fallbackInitial");
  document.querySelector("#profile-name").textContent = user ? name : authText("profile.guest");
  document.querySelector("#profile-email").textContent = user?.email || authText("profile.guestDescription");
  document.querySelector("#profile-avatar").textContent = initial;
  document.querySelector("#profile-avatar").classList.toggle("signed-in", Boolean(user));
  document.querySelector("#profile-shortcut").textContent = user ? initial : authText("nav.account");
  document.querySelector("#profile-shortcut").setAttribute("aria-label", user ? authText("nav.profileAria") : authText("nav.accountAria"));
  document.querySelector("#profile-shortcut").classList.toggle("signed-in", Boolean(user));
  document.querySelector("#ec-balance-wrapper").hidden = !user;
  document.querySelector("#sign-out").hidden = !user;
  document.querySelector("#auth-form").hidden = Boolean(user);
  document.querySelector(".auth-tabs").hidden = Boolean(user);
  document.querySelector("#firebase-notice").hidden = Boolean(user);
  document.querySelector(".auth-privacy").hidden = Boolean(user);
  document.querySelector("#auth-title").textContent = user ? authText("profile.signedInTitle") : authMode === "register" ? authText("profile.registerTitle") : authText("profile.loginTitle");
  document.querySelector("#auth-subtitle").textContent = user ? authText("profile.signedInDescription") : authMode === "register" ? authText("profile.registerDescription") : authText("profile.loginDescription");
  if (user) showAuthMessage(authText("profile.signedInMessage"), "success");
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

  firebaseNotice.textContent = authText("profile.firebaseConnecting");
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
    firebaseNotice.textContent = authText("profile.firebaseConnected");
  } catch (error) {
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
      "auth/email-already-in-use": authText("profile.invalidCredential"),
      "auth/invalid-email": authText("profile.invalidEmail"),
      "auth/user-disabled": authText("profile.userDisabled"),
      "auth/too-many-requests": authText("profile.tooManyRequests"),
      "auth/network-request-failed": authText("profile.networkError"),
      "auth/email-already-in-use": authText("profile.emailInUse"),
      "auth/weak-password": authText("profile.weakPassword")
    };
    showAuthMessage(messages[error.code] || authText("profile.authError", {
      code: error.code || "unknown",
      message: error.message
    }));
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

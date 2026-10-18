const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const firebaseNotice = document.querySelector("#firebase-notice");
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
  showAuthMessage("");
}

authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));

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
  submit.disabled = true;
  showAuthMessage(authMode === "register" ? authText("profile.creatingAccount") : authText("profile.loggingIn"), "info");
  try {
    if (authMode === "register") {
      const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
      if (displayName) await credential.user.updateProfile({ displayName });
    } else {
      await firebaseAuth.signInWithEmailAndPassword(email, password);
    }
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    submit.disabled = false;
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

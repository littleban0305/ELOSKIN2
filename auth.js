const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const firebaseNotice = document.querySelector("#firebase-notice");
const authTabs = document.querySelectorAll("[data-auth-mode]");
const firebaseConfig = window.ELOSKIN_FIREBASE_CONFIG;
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
  document.querySelector("#auth-title").textContent = registering ? "建立你的帳號" : "歡迎回來";
  document.querySelector("#auth-subtitle").textContent = registering ? "註冊 ELOSKIN2 玩家帳號。" : "使用電子郵件登入 ELOSKIN2。";
  document.querySelector("#auth-submit").textContent = registering ? "建立帳號" : "登入";
  document.querySelector("#display-name-field").hidden = !registering;
  document.querySelector("#confirm-password-field").hidden = !registering;
  document.querySelector("#password").autocomplete = registering ? "new-password" : "current-password";
  document.querySelector("#confirm-password").required = registering;
  showAuthMessage("");
}

authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));

function updateAccount(user) {
  window.eloAuthUser = user;
  const name = user?.displayName || user?.email?.split("@")[0] || "訪客";
  const initial = [...name.trim()][0]?.toLocaleUpperCase("zh-Hant") || "E";
  document.querySelector("#profile-name").textContent = user ? name : "訪客";
  document.querySelector("#profile-email").textContent = user?.email || "登入或註冊以使用個人帳號";
  document.querySelector("#profile-avatar").textContent = initial;
  document.querySelector("#profile-avatar").classList.toggle("signed-in", Boolean(user));
  document.querySelector("#profile-shortcut").textContent = user ? initial : "登入 / 註冊";
  document.querySelector("#profile-shortcut").setAttribute("aria-label", user ? "個人頁面" : "登入或註冊");
  document.querySelector("#profile-shortcut").classList.toggle("signed-in", Boolean(user));
  document.querySelector("#sign-out").hidden = !user;
  document.querySelector("#auth-form").hidden = Boolean(user);
  document.querySelector(".auth-tabs").hidden = Boolean(user);
  document.querySelector("#firebase-notice").hidden = Boolean(user);
  document.querySelector(".auth-privacy").hidden = Boolean(user);
  document.querySelector("#auth-title").textContent = user ? "已登入" : authMode === "register" ? "建立你的帳號" : "歡迎回來";
  document.querySelector("#auth-subtitle").textContent = user ? "你的 Firebase 帳號已連線。" : authMode === "register" ? "註冊 ELOSKIN2 玩家帳號。" : "使用電子郵件登入 ELOSKIN2。";
  if (user) showAuthMessage("帳號已安全登入。", "success");
}

function isConfigured(config) {
  return Boolean(config && config.apiKey && config.authDomain && config.projectId && config.appId);
}

function loadFirebaseScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 Firebase SDK：${source}`));
    document.head.append(script);
  });
}

async function initializeFirebase() {
  if (!isConfigured(firebaseConfig)) {
    firebaseNotice.textContent = "尚未設定 Firebase。填入 firebase-config.js 並啟用 Email/Password 驗證後，即可開放登入與註冊。";
    return;
  }

  firebaseNotice.textContent = "正在連線 Firebase Authentication…";
  try {
    const version = "10.14.1";
    await loadFirebaseScript(`https://www.gstatic.com/firebasejs/${version}/firebase-app-compat.js`);
    await loadFirebaseScript(`https://www.gstatic.com/firebasejs/${version}/firebase-auth-compat.js`);
    const firebase = window.firebase;
    if (!firebase) throw new Error("Firebase SDK 載入後未提供 firebase 物件。");
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    firebaseAuth.onAuthStateChanged(updateAccount, (error) => {
      showAuthMessage(`帳號狀態更新失敗：${error.message}`);
    });
    firebaseReady = true;
    firebaseNotice.textContent = "Firebase 已連線。請使用你的電子郵件與密碼登入或註冊。";
  } catch (error) {
    firebaseNotice.textContent = `Firebase 初始化失敗：${error.message}`;
    showAuthMessage(`Firebase 初始化失敗：${error.message}`);
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseReady || !firebaseAuth) {
    showAuthMessage("尚未設定 Firebase，請先填入 firebase-config.js 的專案設定。");
    return;
  }

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const displayName = document.querySelector("#display-name").value.trim();
  const confirmPassword = document.querySelector("#confirm-password").value;
  if (authMode === "register" && password !== confirmPassword) {
    showAuthMessage("兩次輸入的密碼不一致。");
    return;
  }

  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  showAuthMessage(authMode === "register" ? "正在建立帳號…" : "正在登入…", "info");
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
    showAuthMessage("已登出。", "success");
  } catch (error) {
    showAuthMessage(`登出失敗：${error.message}`);
  }
});

initializeFirebase();

# ELOSKIN2

首頁依 ELOSKIN2 的獨立版型呈現 CS2 與 Roblox Rivals 商店、玩家交換、新手指南及交易安全說明。商店以 ELOCoin（EC）標價；CS2 商品庫存可從主要 Steam 帳號讀取，只列出可交易物品。商品搜尋、類別／遊戲篩選、排序、收藏與購物車在前端運作。

## 編輯網站文字

網站介面文案集中在 `content.js`。導覽、首頁、商店、玩家刊登、登入註冊、狀態提示、商品範例與篩選分類都從此檔讀取：

- 直接編輯對應區塊中的文字值；商品範例與玩家刊登資料也在此檔。
- `index.html` 的 `data-copy`、`data-copy-aria`、`data-copy-placeholder`、`data-copy-alt` 和 `data-copy-content` 屬性連到文案鍵。
- `app.js` 與 `auth.js` 用 `t("區塊.鍵名")` 讀取動態訊息，例如 `t("shop.empty")`。
- 新增文案時，先在 `content.js` 對應區塊新增鍵，再於 HTML 或 JavaScript 使用該鍵。缺少的鍵會明確拋出錯誤，方便定位。
- Steam 即時庫存名稱、Firebase 驗證服務回傳的錯誤內容，以及使用者的顯示名稱不是網站靜態文案，因此仍由服務或使用者提供。

## 編輯網站圖示

網站操作圖示集中在 `assets/icon_new/`，目前導覽列購物車、搜尋、交換、加入購物車、收藏、關閉視窗及導覽箭頭都使用此資料夾的 PNG。商品收藏會依狀態切換 `heart_plus` 和 `heart_minus`。

## GitHub Pages 部署

此專案使用 GitHub Actions 自動發布。將變更推送至 `main` 分支後，可在 GitHub repo 的 **Actions** 頁面查看發布狀態；首次成功發布後，網站網址會是 `https://littleban0305.github.io/ELOSKIN2/`。公開 Pages 網站任何人都能瀏覽，並看見網站上顯示的 Steam 交易連結。

SkinApe 累積收益回饋目前展示 1,000 回饋 100 EC、10,000 回饋 1,000 EC，其餘級距仍待確認。EC 餘額、價格、Rivals 庫存和玩家刊登皆為展示資料，不是即時市場資料；CS2 庫存可按下文設定為讀取 Steam 公開庫存。

首頁精選區最多顯示 5 件官方商品；下方玩家寄售區展示的是玩家刊登範例。

Roblox Rivals 商品仍為展示資料。CS2 商品名稱、圖示與庫存來自 Steam 公開物品庫；未設定 EC 價格的 CS2 物品會標示「需設定 EC 價格」，不能加入購物車。可於 `steam-config.js` 的 `ecPrices` 依 Steam `market_hash_name` 設定 EC 價格。Steam 庫存並非即時訂單保留，完成 Steam 交易後請重新讀取。

## 啟用 Steam 庫存讀取

GitHub Pages 是靜態網站，不能直接讀取 Steam 庫存 API（Steam 不開放瀏覽器跨來源請求）。使用 Cloudflare Worker 作為只讀代理：

1. 在 Cloudflare Dashboard 開啟現有 `eloskin2` Worker，將本專案更新後的 `steam-inventory-worker.js` 全文貼入 Worker 編輯器並部署。原有 `/inventory` 庫存讀取路由會保留。
2. 在 Worker 設定環境變數 `ALLOWED_ORIGINS`。這是「允許哪個網站呼叫 Worker」的安全名單，填 ELOSKIN2 網站網址的開頭（協定 + 網域），不是 Worker 網址：
   - 若 GitHub Pages 網址是 `https://alice.github.io/ELOSKIN2/`，填 `https://alice.github.io`。把 `alice` 換成你的 GitHub 使用者名稱；不要加 `/ELOSKIN2/`。
   - 若也要在本機測試，另外加上本機網址的來源，例如 `http://localhost:8000`。用逗號分隔，不能加空格：`https://alice.github.io,http://localhost:8000`。
   - 設定位置：Cloudflare Dashboard → Workers & Pages → 選擇你的 Worker → Settings → Variables and Secrets → Add variable。名稱填 `ALLOWED_ORIGINS`，值填上面整理好的網址，儲存後重新部署／生效。
   - 如果網站使用自訂網域，填自訂網域的開頭，例如 `https://skins.example.com`。不要填 `file://` 開啟的本機檔案網址。
3. 確認 Steam 個人資料及物品庫設為公開。此 Worker 固定讀取 Steam ID `76561199883868233` 的 CS2（App 730）物品庫，只回傳可交易物品，最多讀取 20,000 件；Steam 上游回應會由 Cloudflare 快取 60 秒。
4. Worker 網址已接入 `steam-config.js`：`https://eloskin2.littleban0305.workers.dev/inventory`。目前 `ALLOWED_ORIGINS` 已允許 `https://littleban0305.github.io`。
5. 網站商店的「重新讀取庫存」按鈕可再次同步。若要設定物品售價，在 `steam-config.js` 的 `ecPrices` 依 Steam 市場名稱填入正整數 EC，例如 `ecPrices: { "AK-47 | Redline (Field-Tested)": 1200 }`。交易按鈕會開啟主要帳號提供的 Steam 交易連結。

Steam 交易連結會公開在網站前端；任何能瀏覽網站的人都能看到該連結。不要將 Steam 密碼、API 金鑰或登入 Cookie 放進 Worker 或前端。

## 啟用 Firebase 登入／註冊

1. 在 Firebase Console 的 Authentication 啟用 Email/Password 與 Google 登入方式。登入時若電子郵件尚無密碼帳號，網站會用該郵件和輸入的密碼自動建立帳號。
2. 將 Firebase Web App 設定的 `apiKey`、`authDomain`、`projectId`、`appId` 填入 `firebase-config.js`。這些是 Firebase 用戶端設定；不要在前端放置服務帳號金鑰。
3. 在 Firebase Authentication 的授權網域加入 `littleban0305.github.io`（本機開發可加入 `localhost`）。使用 Google 登入時會開啟 Google 帳號選擇視窗。
4. 從 `http://localhost` 或部署後的網站網址開啟，不要直接以 `file://` 開啟。
5. Google 登入會顯示 Google 頭像；Steam 登入會讀取公開 Steam 頭像。自訂頭像會縮小後儲存在目前瀏覽器的本機空間，不需啟用 Firebase Storage 或升級 Blaze；它不會同步到其他裝置或瀏覽器。支援 JPG、PNG、WebP，原始圖片上限 5 MB。清除瀏覽器網站資料也會移除本機自訂頭像。
6. Steam 登入會使用同一個 Cloudflare Worker 完成 Steam OpenID 驗證，並由 Firebase Custom Token 建立 `steam:<SteamID64>` 帳號。將最新版 `steam-inventory-worker.js` 全文部署到 Cloudflare Worker；只更新 GitHub Pages 不會更新 Worker。若登入失敗，網站會指出是 Steam 驗證服務或 Firebase Secret 的問題。Worker 登入功能需要以下三項 **Secret**（不可設為一般明文變數或提交到 Git）：
   - `FIREBASE_SERVICE_ACCOUNT_EMAIL`：Firebase Console → Project settings → Service accounts，使用 Firebase Admin SDK 服務帳號的 `client_email`。
   - `FIREBASE_PRIVATE_KEY`：同一服務帳號 JSON 檔中的 `private_key` 完整內容。金鑰只需留在本機與 Cloudflare Secret，不要傳給任何人或貼進程式碼。
   - `STEAM_STATE_SECRET`：自行產生至少 32 個隨機位元組的隨機字串，用於簽署 Steam 登入狀態 Cookie。

   可在 Cloudflare Dashboard → Workers & Pages → 選擇 `eloskin2` Worker → Settings → Variables and Secrets → Add → **Secret** 新增上述值。Worker 會用 HttpOnly、Secure、SameSite=Lax Cookie 綁定 Steam OpenID 回呼與原始網站，驗證成功後才簽發短效 Firebase Custom Token。`ALLOWED_ORIGINS` 必須包含 `https://littleban0305.github.io`；程式中的 `steam-config.js` 已設定 `authEndpoint` 指向此 Worker。設定 Secret 後重新部署 Worker。
7. 管理者 `littleban0305@gmail.com` 可在個人頁面管理商品上／下架。要讓商品狀態同步給所有訪客，請在 Firebase Console → **Firestore Database** 建立資料庫（選擇免費 Spark 方案可用的區域），然後將 [firestore.rules](./firestore.rules) 貼入 Firestore Rules 並發布。管理者首次以 Email/Password 登入時，需先驗證該信箱；Google 登入使用已驗證的 Google 帳號。Firestore 免費方案不需 Blaze，但受 Firebase 免費配額限制。

ELOSKIN2 的目標使用者是受邀朋友，但目前原型尚未設定朋友白名單或頁面存取限制；不要把它當作已啟用的私人網站。

EC 餘額、Rivals 商品、玩家刊登及交易提案仍是前端展示資料。Steam 庫存同步僅用來顯示主要帳號目前的可交易 CS2 物品，不會自動估價、建立真實訂單、扣款或送出 Steam 交易。購物車庫存限制僅在目前頁面生效，不是即時庫存保留。管理者商品上／下架狀態透過 Firestore 同步；管理介面每次最多顯示 100 筆搜尋結果。

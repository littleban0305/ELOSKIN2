# ELOSKIN2

ELOSKIN2 是供朋友使用的 CS2 與 Roblox 道具交易網站。商店、首頁和交易頁只顯示管理員在「管理 → 上架物品」上架的物品（存放在 Firestore 的 `listings`），不再直接讀取 Steam 庫存。上架時可以自創物品，或從站方的 Steam 庫存匯入，並設定標籤、EC 價格與數量。Firestore 無法連線時才會顯示展示商品。真實交易提案尚未連接。右上角登入視窗支援 Email、Google 與 Steam；首次登入需設定顯示名稱和 Steam 交易連結。

## 編輯網站文字

網站介面文案集中在 `content.js`。導覽、商店、登入註冊、狀態提示與篩選分類都從此檔讀取：

- 直接編輯對應區塊中的文字值。
- `index.html` 的 `data-copy`、`data-copy-aria`、`data-copy-placeholder`、`data-copy-alt` 和 `data-copy-content` 屬性連到文案鍵。
- `app.js` 與 `auth.js` 用 `t("區塊.鍵名")` 讀取動態訊息，例如 `t("shop.empty")`。
- 新增文案時，先在 `content.js` 對應區塊新增鍵，再於 HTML 或 JavaScript 使用該鍵。缺少的鍵會明確拋出錯誤，方便定位。
- Steam 即時庫存名稱、Firebase 驗證服務回傳的錯誤內容，以及使用者的顯示名稱不是網站靜態文案，因此仍由服務或使用者提供。

## 編輯網站圖示

網站操作圖示集中在 `assets/icon_new/`，目前導覽列購物車、搜尋、交換、加入購物車、收藏、關閉視窗及導覽箭頭都使用此資料夾的 PNG。商品收藏會依狀態切換 `heart_plus` 和 `heart_minus`。

## GitHub Pages 部署

此專案使用 GitHub Actions 自動發布。將變更推送至 `main` 分支後，可在 GitHub repo 的 **Actions** 頁面查看發布狀態；首次成功發布後，網站網址會是 `https://littleban0305.github.io/ELOSKIN2/`。公開 Pages 網站任何人都能瀏覽。

首頁與商店的商品來自 Firestore `listings`。Cloudflare Worker 的 `/inventory` 只在管理頁「從 Steam 匯入」時使用。網站不會建立真實訂單。

## 啟用 Steam 庫存讀取

GitHub Pages 是靜態網站，不能直接讀取 Steam 庫存 API（Steam 不開放瀏覽器跨來源請求）。使用 Cloudflare Worker 作為只讀代理：

1. 在 Cloudflare Dashboard 開啟現有 `eloskin2` Worker，將本專案更新後的 `steam-inventory-worker.js` 全文貼入 Worker 編輯器並部署。原有 `/inventory` 庫存讀取路由會保留。
2. 在 Worker 設定環境變數 `ALLOWED_ORIGINS`。這是「允許哪個網站呼叫 Worker」的安全名單，填 ELOSKIN2 網站網址的開頭（協定 + 網域），不是 Worker 網址：
   - 若 GitHub Pages 網址是 `https://alice.github.io/ELOSKIN2/`，填 `https://alice.github.io`。把 `alice` 換成你的 GitHub 使用者名稱；不要加 `/ELOSKIN2/`。
   - 若也要在本機測試，另外加上本機網址的來源，例如 `http://localhost:8000`。用逗號分隔，不能加空格：`https://alice.github.io,http://localhost:8000`。
   - 設定位置：Cloudflare Dashboard → Workers & Pages → 選擇你的 Worker → Settings → Variables and Secrets → Add variable。名稱填 `ALLOWED_ORIGINS`，值填上面整理好的網址，儲存後重新部署／生效。
   - 如果網站使用自訂網域，填自訂網域的開頭，例如 `https://skins.example.com`。不要填 `file://` 開啟的本機檔案網址。
3. 確認 Steam 個人資料及物品庫設為公開。此 Worker 固定讀取 Steam ID `76561199883868233` 的 CS2（App 730）物品庫，只回傳可交易物品，最多讀取 20,000 件；Steam 上游分頁回應會由 Cloudflare 快取 60 秒，成功取得的完整庫存會快取 5 分鐘。
4. Worker 網址已接入 `steam-config.js`：`https://eloskin2.littleban0305.workers.dev/inventory`。目前 `ALLOWED_ORIGINS` 已允許 `https://littleban0305.github.io`。
5. 只有管理頁的「從 Steam 匯入」會讀取這個庫存；商品的 EC 價格在管理頁設定。
6. **建議設定 Steam Web API 金鑰。** Steam 經常以 HTTP 429 拒絕 Cloudflare Worker 直接讀取社群庫存網址。設定金鑰後，Worker 會改用官方的 `IEconService/GetInventoryItemsWithDescriptions` API：
   - 到 https://steamcommunity.com/dev/apikey 申請金鑰（網域可填 `littleban0305.github.io`）。
   - Cloudflare Dashboard → Workers & Pages → `eloskin2` → Settings → Variables and Secrets → Add → **Secret**，名稱 `STEAM_API_KEY`，值為金鑰。
   - 把最新版 `steam-inventory-worker.js` 貼進 Worker 編輯器並部署。金鑰只放在 Worker Secret，不要放進前端或 Git。

Steam 交易連結會公開在網站前端；任何能瀏覽網站的人都能看到該連結。不要將 Steam 密碼或登入 Cookie 放進 Worker 或前端；Steam API 金鑰只能放在 Worker 的 Secret。

## 啟用 Firebase 登入／註冊

1. 在 Firebase Console 的 Authentication 啟用 Email/Password、Google 與 **Anonymous** 登入方式。匿名登入用於記錄首頁全站收藏數，不會顯示成已登入的個人帳號。登入時若電子郵件尚無密碼帳號，網站會用該郵件和輸入的密碼自動建立帳號。
2. 將 Firebase Web App 設定的 `apiKey`、`authDomain`、`projectId`、`appId` 填入 `firebase-config.js`。這些是 Firebase 用戶端設定；不要在前端放置服務帳號金鑰。
3. 在 Firebase Authentication 的授權網域加入 `littleban0305.github.io`（本機開發可加入 `localhost`）。使用 Google 登入時會開啟 Google 帳號選擇視窗。
4. 從 `http://localhost` 或部署後的網站網址開啟，不要直接以 `file://` 開啟。
5. Google 登入會顯示 Google 頭像；Steam 登入會讀取公開 Steam 頭像。自訂頭像會縮小後儲存在目前瀏覽器的本機空間，不需啟用 Firebase Storage 或升級 Blaze；它不會同步到其他裝置或瀏覽器。支援 JPG、PNG、WebP，原始圖片上限 5 MB。清除瀏覽器網站資料也會移除本機自訂頭像。
6. Steam 登入會使用同一個 Cloudflare Worker 完成 Steam OpenID 驗證，並由 Firebase Custom Token 建立 `steam:<SteamID64>` 帳號。將最新版 `steam-inventory-worker.js` 全文部署到 Cloudflare Worker；只更新 GitHub Pages 不會更新 Worker。若登入失敗，網站會指出是 Steam 驗證服務或 Firebase Secret 的問題。Worker 登入功能需要以下三項 **Secret**（不可設為一般明文變數或提交到 Git）：
   - `FIREBASE_SERVICE_ACCOUNT_EMAIL`：Firebase Console → Project settings → Service accounts，使用 Firebase Admin SDK 服務帳號的 `client_email`。
   - `FIREBASE_PRIVATE_KEY`：同一服務帳號 JSON 檔中的 `private_key` 完整內容。金鑰只需留在本機與 Cloudflare Secret，不要傳給任何人或貼進程式碼。
   - `STEAM_STATE_SECRET`：自行產生至少 32 個隨機位元組的隨機字串，用於簽署 Steam 登入狀態 Cookie。

   可在 Cloudflare Dashboard → Workers & Pages → 選擇 `eloskin2` Worker → Settings → Variables and Secrets → Add → **Secret** 新增上述值。Worker 會用 HttpOnly、Secure、SameSite=Lax Cookie 綁定 Steam OpenID 回呼與原始網站，驗證成功後才簽發短效 Firebase Custom Token。`ALLOWED_ORIGINS` 必須包含 `https://littleban0305.github.io`；程式中的 `steam-config.js` 已設定 `authEndpoint` 指向此 Worker。設定 Secret 後重新部署 Worker。
7. 管理者 `littleban0305@gmail.com` 登入後，導覽列會出現「管理」頁面：「商品」分頁可編輯名稱、EC 價格、數量、說明、標籤、上／下架與刪除；「上架物品」分頁可自創物品或從 Steam 匯入；「Q&A」分頁可編輯首頁常見問題。變更會自動儲存到 Firestore（`listings`、`siteSettings/faq`）。這些功能需要 Firestore：在 Firebase Console → **Firestore Database** 建立資料庫（選擇免費 Spark 方案可用的區域），然後將 [firestore.rules](./firestore.rules) 貼入 Firestore Rules 並發布。未上架的物品只有管理員讀得到。個人顯示名稱與 Steam 交易連結只允許本人讀寫；收藏者資料只允許本人讀取，公開計數只能隨收藏投票交易更新。管理者首次以 Email/Password 登入時，需先驗證該信箱；Google 登入使用已驗證的 Google 帳號。Firestore 免費方案不需 Blaze，但受 Firebase 免費配額限制。

ELOSKIN2 的目標使用者是受邀朋友，但目前原型尚未設定朋友白名單或頁面存取限制；不要把它當作已啟用的私人網站。

商品與玩家刊登範例目前已移除，商店及交易功能頁暫時只保留頁首。管理頁每次最多顯示 100 筆商品，可用搜尋或篩選縮小範圍。圖片目前用網址填寫（Firebase Storage 需要 Blaze 方案）。

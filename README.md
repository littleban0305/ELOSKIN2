# ELOSKIN2

給朋友用的 CS2／Roblox 道具交易網站（目前是給弟弟的 close beta）。網址：https://littleban0305.github.io/ELOSKIN2/

推送到 `main` 後，GitHub Actions（`.github/workflows/pages.yml`）會自動發布到 GitHub Pages。

## 架構

| 部分 | 放哪裡 | 用途 |
|---|---|---|
| 網站 | GitHub Pages（這個 repo） | 純前端，沒有自己的伺服器 |
| 資料庫、登入 | Firebase（Spark 免費方案） | Auth：Email、Google、Steam；Firestore 存所有資料 |
| Steam 登入 | Cloudflare Worker（`steam-auth-worker.js`） | Steam OpenID 驗證後簽發 Firebase Custom Token |
| 讀 Steam 庫存 | 家裡手機的中繼站（`relay/`） | Steam 會擋雲端主機，所以用家用網路讀；說明見 [relay/README.md](./relay/README.md) |
| 自動出貨 | 同一支手機的交易機器人（`relay/bot.mjs`） | 送 Steam 交易報價、買家接受後自動完成訂單；設定見 [relay/README.md](./relay/README.md) 第五節 |
| 市價 | SteamAnalyst API | 每位使用者在個人頁貼自己的免費金鑰；查到的價格存進 `marketPrices` 大家共用 |
| 台幣匯率 | open.er-api.com | 換算 EC 用，0.03 台幣 = 1 EC |

## 主要檔案

- `index.html`：所有頁面（首頁、商店、交易、個人、儲值、通知、管理）
- `content.js`：網站上所有文字。改文案只要改這裡，HTML 用 `data-copy` 系列屬性、JS 用 `t("區塊.鍵名")` 讀取
- `app.js`：商店、交易、個人頁（金鑰、庫存讀取）、手機選單
- `auth.js`：Firebase 初始化、登入、個人資料
- `admin.js`：管理頁（商品、上架、訂單、儲值、Q&A）
- `orders.js`：購買與交易訂單、通知
- `wallet.js`：EC 錢包與儲值
- `coupons.js`：折價券、禮品券（管理頁「禮券」建立，使用者在「兌換禮券」頁兌換、購物車選券）
- `prices.js`：SteamAnalyst 查價（每分鐘 30 次、24 小時 100 次排隊）
- `inventory-import.js`：書籤、剪貼簿讀庫存
- `item-details.js`：從 Steam 資料抓磨損等級、磨損值、圖案編號、StatTrak™、貼紙、吊飾、命名牌（網站和中繼站共用）
- `firestore.rules`：Firestore 安全規則，**每次改完都要到 Firebase Console → Firestore → 規則 貼上並發布**
- `mobile.css`：手機版（720px 以下）排版

## Firestore 集合

| 集合 | 內容 |
|---|---|
| `listings` | 上架商品 |
| `siteSettings/faq` | 首頁 Q&A |
| `orders`、`notifications` | 訂單、通知 |
| `wallets`、`walletTransactions`、`topups` | EC 餘額、紀錄、儲值申請 |
| `userProfiles` | 顯示名稱、Steam 交易連結 |
| `userSecrets` | 使用者自己的 SteamAnalyst 金鑰（只有本人讀寫） |
| `userInventories` | 使用者的 Steam 庫存（同步到不同裝置） |
| `inventoryRequests`、`relayStatus`、`adminInventory` | 中繼站的請求、中繼站和交易機器人的在線狀態（`relayStatus/inventory`、`relayStatus/bot`）、管理頁上架用庫存 |
| `marketPrices` | 共用的 SteamAnalyst 價格快取 |
| `productFavorites`、`productFavoriteCounts` | 收藏 |
| `coupons`、`userCoupons` | 禮券（代碼當文件 id，只有知道代碼才讀得到）、使用者領到的券 |

## Cloudflare Worker（Steam 登入）

`steam-auth-worker.js` 只負責 Steam 登入（讀庫存已經改由中繼站處理）。更新時把整份貼進 Cloudflare Dashboard → Workers & Pages → `eloskin2` 的編輯器並部署。需要的設定：

- 變數 `ALLOWED_ORIGINS`：`https://littleban0305.github.io`
- Secret `FIREBASE_SERVICE_ACCOUNT_EMAIL`、`FIREBASE_PRIVATE_KEY`：Firebase 服務帳戶的 `client_email` 和 `private_key`
- Secret `STEAM_STATE_SECRET`：自己產生的隨機字串（至少 32 位元組）

## 待辦與已知問題

統一記在 Claude Docs 的「ELOSKIN2 專案分析」文件。

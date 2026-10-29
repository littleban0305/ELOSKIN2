# ELOSKIN2 庫存中繼站

放在家裡的舊手機上跑。網站按「立即讀取」或庫存超過 6 小時沒更新時，這支程式會用手機的網路去跟 Steam 讀庫存，再寫回網站。

Steam 會擋雲端主機（Cloudflare、GitHub），但不會擋家用 Wi-Fi 或行動網路，所以要用手機跑。手機只需要連網，不用開任何連接埠，也不用 Cloudflare Tunnel。

## 一、手機安裝 Termux（只做一次）

1. 到 F-Droid 下載 **Termux**（Google Play 上的版本太舊，不要用）：https://f-droid.org/packages/com.termux/
2. 想要開機自動啟動的話，再裝 **Termux:Boot**：https://f-droid.org/packages/com.termux.boot/
3. 打開 Termux，依序貼上：

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs git
termux-setup-storage
git clone https://github.com/littleban0305/ELOSKIN2.git
cd ELOSKIN2/relay
npm install
```

`termux-setup-storage` 會跳出權限視窗，按允許。

## 二、放入 Firebase 服務帳戶金鑰（只做一次）

1. 電腦打開 Firebase Console → 你的專案 → 左上齒輪「專案設定」→「服務帳戶」分頁。
2. 按「產生新的私密金鑰」，會下載一個 `.json` 檔。
3. 把這個檔案傳到中繼站手機的「下載」資料夾（用 LINE 傳給自己、USB 或 Google 雲端硬碟都可以）。
4. 在 Termux 執行（檔名換成你下載的名字）：

```bash
cp ~/storage/downloads/你的檔名.json ~/ELOSKIN2/relay/serviceAccount.json
```

這個金鑰等於整個資料庫的管理員權限：**不要傳給別人、不要上傳到 GitHub**（專案的 `.gitignore` 已經排除它了）。

## 三、啟動

```bash
cd ~/ELOSKIN2/relay
./start.sh
```

看到「庫存中繼站啟動」就成功了，網站個人頁面的 Steam 庫存卡片會顯示「中繼站在線」。程式當掉或斷網時，`start.sh` 會自己重開；每次重開也會順便更新到 GitHub 上的最新版本。

## 四、讓它一直開著

- 手機設定 → 應用程式 → Termux → 電池 → 選「不受限制」（或關閉電池最佳化）。
- 通知欄的 Termux 通知不要滑掉。`start.sh` 會自動開啟 wake lock，讓手機螢幕關掉時也不會睡著。
- 接上充電器、連家裡 Wi-Fi 放著就好。

開機自動啟動（有裝 Termux:Boot 的話）：

```bash
mkdir -p ~/.termux/boot
printf '#!/data/data/com.termux/files/usr/bin/bash\n~/ELOSKIN2/relay/start.sh > ~/relay.log 2>&1\n' > ~/.termux/boot/start-relay.sh
chmod +x ~/.termux/boot/start-relay.sh
```

裝完 Termux:Boot 後要先手動打開它一次，之後手機重開機就會自動跑。

## 五、Steam 交易機器人（選用）

裝好之後，網站的訂單就能自動出貨：

- **購買訂單**（只用 EC 付款、商品是從 Steam 庫存上架的）：買家一下單，機器人就自動送出 Steam 交易報價。
- **交易訂單**（買家也要給物品）：管理員在管理頁看過價錢沒問題，按「交給機器人」才會送。
- 買家在 Steam 按接受 → 訂單自動完成、扣 EC、扣庫存、寫錢包紀錄、通知買家；拒絕或 24 小時沒接受 → 訂單自動取消，不扣 EC。
- 自訂商品、機器人庫存找不到的物品、Steam 出錯：訂單會標成「需要手動處理」並通知管理員，修好後可以按「重新交給機器人」。

### 兩種模式

| | 全自動 | 半自動（不用 maFile） |
|---|---|---|
| 帳號 | 另開一個機器人帳號（要消費滿 5 美元） | 直接用你現有的主帳號 |
| 驗證器 | 用 SDA 綁，拿得到密鑰 | 保留官方 Steam App 的驗證器，不用移除 |
| 送報價 | 機器人自己確認 | 機器人送出後，你要在手機 Steam App →「確認」按一下，管理頁也會收到通知 |
| 設定 | 下面第 1～4 步全部 | 跳過第 1、2 步，`bot-config.json` 只填 `accountName`、`password`，刪掉 `maFile` 那行 |

半自動第一次啟動要在 Termux 手動跑 `node bot.mjs`，它會問 Steam App 上的驗證碼，輸入一次之後就會記住登入狀態（存在 `bot-data/`，大約半年後才要再輸入）。半自動預設**不會**拒絕別人送給你的報價，因為那是你的主帳號；機器人只會送已經上架的物品。

### 1. 準備機器人帳號

建議**另外開一個 Steam 帳號**專門當機器人，把要賣的物品放進去。這個帳號要符合：

- 不是受限帳號：在 Steam 商店累積消費滿 5 美元（儲值錢包也算）。
- 庫存設成公開（個人檔案 → 隱私設定 → 庫存：公開）。
- 有 Steam 手機驗證器，而且拿得到驗證器的密鑰（shared_secret、identity_secret）。官方 Steam App 拿不到，所以要用下面的 SDA 綁。

> 如果想用現有的帳號，而且它已經用官方 Steam App 開了驗證器，就要先移除再改用 SDA 綁，**Steam 會因此鎖交易 15 天**，所以才建議開新帳號。

### 2. 用 Steam Desktop Authenticator（SDA）綁驗證器（在 Windows 電腦做）

1. 下載 SDA：https://github.com/Jessecar96/SteamDesktopAuthenticator/releases （下載最新版的 zip，解壓縮後執行 `Steam Desktop Authenticator.exe`）。
2. 問要不要加密時**留空、不要加密**（加密的話手機上的機器人讀不了）。
3. 按「Setup New Account」，登入機器人帳號，照畫面輸入手機號碼和簡訊驗證碼。
4. 會給你一組 **R 開頭的復原碼**，一定要抄下來收好（之後換手機或出問題要用）。
5. 完成後，SDA 資料夾裡的 `maFiles` 會有一個 `一串數字.maFile` 檔案。

綁好驗證器的前 7 天，Steam 會暫留這個帳號的交易，機器人會回報「機器人帳號的交易會被暫留」，等 7 天過了就好。

### 3. 放到中繼站手機

1. 把 `.maFile` 傳到手機的「下載」資料夾（跟服務帳戶金鑰一樣的方法）。
2. 在 Termux 執行（檔名換成你的）：

```bash
cd ~/ELOSKIN2/relay
cp ~/storage/downloads/一串數字.maFile bot.maFile
cp bot-config.example.json bot-config.json
nano bot-config.json
```

3. 在 `nano` 裡填好（改完按 `Ctrl + O`、`Enter` 存檔，再按 `Ctrl + X` 離開）：

| 欄位 | 填什麼 |
|---|---|
| `accountName` | 機器人帳號的登入名稱（不是暱稱） |
| `password` | 機器人帳號的密碼 |
| `maFile` | 保持 `bot.maFile` |
| `autoPurchase` | `true` 購買訂單自動出貨；`false` 全部都要管理員按「交給機器人」 |
| `offerTimeoutMinutes` | 報價多久沒接受就收回，預設 1440（24 小時） |
| `ownerSteamIds` | 你自己主帳號的 SteamID64，例如 `["7656119xxxxxxxxxx"]`。從這些帳號送給機器人的物品（機器人不用給東西）會自動收下，方便補貨 |
| `declineUnknownOffers` | `true` 其他人送來的報價一律拒絕 |

`bot-config.json` 和 `bot.maFile` 等於整個機器人帳號的鑰匙：**不要傳給任何人、不要貼到聊天室**。`.gitignore` 已經排除它們，不會被上傳。

### 4. 第一次啟動

```bash
cd ~/ELOSKIN2/relay
git pull
npm install
node bot.mjs
```

看到「已登入 Steam」和「交易功能就緒」就成功了，按 `Ctrl + C` 停掉，之後用 `./start.sh` 啟動（有 `bot-config.json` 時會同時開中繼站和機器人）。管理頁「訂單」分頁右上角會顯示「交易機器人在線」。

### 5. 網站這邊要做的

- 把網站 `steam-config.js` 的 `inventorySteamId`、`tradeOfferUrl` 換成機器人帳號的 SteamID64 和交易連結（SteamID64 機器人啟動時會印出來，傳給 Claude 改就好），這樣管理頁「上架」讀到的才是機器人的庫存（機器人只能送自己庫存裡的東西）。
- Firebase Console → Firestore → 規則：貼上最新的 `firestore.rules` 並發布。

### 注意

- 機器人處理中的訂單不能按「完成出貨」，避免重複出貨；按「取消訂單」會自動收回報價。
- 買家的 Steam 如果會被暫留交易（通常是手機驗證器沒開滿 7 天），機器人會直接取消訂單並說明原因。
- CS2 有交易保護：交易後 7 天內，任一方都能在 Steam 把交易撤銷，物品會各自退回，但網站這邊的訂單和 EC 不會自動退。遇到的話請手動處理。
- 機器人從交易訂單收到的物品，7 天內不能再交易，這段時間上架頁也不會出現它們。

## 常見問題

- **網站一直顯示「中繼站離線」**：確認 Termux 裡程式還在跑、手機有網路。中繼站每分鐘回報一次在線狀態，超過 3 分鐘沒回報就會顯示離線。
- **「Steam 庫存不是公開的」**：Steam → 個人檔案 → 編輯個人檔案 → 隱私設定，把「庫存」改成公開。
- **「Steam 暫時限流」**：Steam 嫌讀太多次，中繼站會等 90 秒後自己重試，不用管它。
- **耗電/記憶體**：閒置時幾乎不吃電，記憶體大約 100 MB（開交易機器人再多約 100 MB），舊手機就夠用。
- **機器人說「Steam 要求電子郵件驗證碼」**：代表這個帳號沒有用 SDA 綁驗證器，回到第五節第 2 步。
- **機器人說「maFile 打不開，可能有加密」**：在 SDA 的「Manage Encryption」把密碼留空移除加密，再重新複製 maFile。

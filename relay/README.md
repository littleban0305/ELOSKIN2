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

## 常見問題

- **網站一直顯示「中繼站離線」**：確認 Termux 裡程式還在跑、手機有網路。中繼站每分鐘回報一次在線狀態，超過 3 分鐘沒回報就會顯示離線。
- **「Steam 庫存不是公開的」**：Steam → 個人檔案 → 編輯個人檔案 → 隱私設定，把「庫存」改成公開。
- **「Steam 暫時限流」**：Steam 嫌讀太多次，中繼站會等 90 秒後自己重試，不用管它。
- **耗電/記憶體**：閒置時幾乎不吃電，記憶體大約 100 MB，舊手機就夠用。

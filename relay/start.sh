#!/data/data/com.termux/files/usr/bin/bash
# 讓手機不睡死；中繼站和交易機器人當掉或斷網就 10 秒後自動重開
cd "$(dirname "$0")"
termux-wake-lock 2>/dev/null

update() {
  git -C .. pull --ff-only -q 2>/dev/null
  # package.json 有更新（例如多了新套件）就自動重新安裝
  if [ ! -f node_modules/.package-lock.json ] || [ package.json -nt node_modules/.package-lock.json ]; then
    npm install --omit=dev --no-audit --no-fund && touch node_modules/.package-lock.json
  fi
}

run_forever() {
  while true; do
    node "$1"
    echo "$2停止了，10 秒後重新啟動…"
    sleep 10
    [ "$3" = "update" ] && update
  done
}

update
# 有 bot-config.json 才啟動交易機器人
if [ -f bot-config.json ]; then
  run_forever bot.mjs "交易機器人" &
fi
run_forever relay.mjs "中繼站" update

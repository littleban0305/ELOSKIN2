#!/data/data/com.termux/files/usr/bin/bash
# 讓手機不睡死，程式當掉或斷網就 10 秒後自動重開
cd "$(dirname "$0")"
termux-wake-lock 2>/dev/null
while true; do
  git -C .. pull --ff-only -q 2>/dev/null
  node relay.mjs
  echo "中繼站停止了，10 秒後重新啟動…"
  sleep 10
done

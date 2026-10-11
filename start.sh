#!/usr/bin/env bash
# Start SHUTE REAL: launches the local game server and opens the game in your browser.
# Friends on the same network can join using the address printed below.
cd "$(dirname "$(readlink -f "$0")")"
PORT="${PORT:-7777}"

if [ ! -d node_modules/three ] || [ ! -d node_modules/ws ]; then
  echo "First run: installing dependencies..."
  npm install --omit=dev --no-audit --no-fund || { echo "npm install failed. Run ./install.sh"; exit 1; }
fi

# Reuse a server that is already running on this port.
if command -v curl >/dev/null 2>&1 && curl -s "http://localhost:$PORT/api/info" | grep -q "SHUTE REAL"; then
  echo "Server already running on port $PORT"
  SERVER_PID=""
else
  node server/index.js --port "$PORT" "$@" &
  SERVER_PID=$!
  trap '[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM
  for i in $(seq 1 40); do
    sleep 0.25
    if command -v curl >/dev/null 2>&1; then
      curl -s "http://localhost:$PORT/api/info" >/dev/null 2>&1 && break
    fi
  done
fi

URL="http://localhost:$PORT"
# Chromium-based browsers often block the GPU on Linux; these flags turn hardware acceleration on.
GPU_FLAGS="--ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --disable-features=UseChromeOSDirectVideoDecoder"
open_browser() {
  for b in chromium chromium-browser google-chrome google-chrome-stable brave-browser microsoft-edge; do
    if command -v "$b" >/dev/null 2>&1; then
      "$b" $GPU_FLAGS --app="$URL" --start-maximized --user-data-dir="$HOME/.config/shute-real-browser" >/dev/null 2>&1 &
      return 0
    fi
  done
  for b in firefox firefox-esr; do
    if command -v "$b" >/dev/null 2>&1; then
      "$b" --new-window "$URL" >/dev/null 2>&1 &
      return 0
    fi
  done
  xdg-open "$URL" >/dev/null 2>&1 &
}
open_browser
echo ""
echo "SHUTE REAL is running at $URL  (press Ctrl+C here to stop the server)"
if [ -n "$SERVER_PID" ]; then wait "$SERVER_PID"; fi

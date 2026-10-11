#!/usr/bin/env bash
# Dedicated SHUTE REAL server (no browser). Players connect with http://<this-ip>:7777
#   ./server.sh                       default port 7777
#   ./server.sh --port 8000 --name "Friday Night Ops"
cd "$(dirname "$(readlink -f "$0")")"
if [ ! -d node_modules/three ] || [ ! -d node_modules/ws ]; then
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
exec node server/index.js "$@"

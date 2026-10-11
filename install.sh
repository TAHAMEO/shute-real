#!/usr/bin/env bash
# SHUTE REAL installer for Kali Linux (also works on Debian, Ubuntu, Parrot, Mint...).
# Installs Node.js if needed, downloads the game's two dependencies (three.js, ws)
# and adds a "SHUTE REAL" launcher to your applications menu.
set -e
cd "$(dirname "$(readlink -f "$0")")"
GAME_DIR="$(pwd)"

echo ""
echo "  ███████╗██╗  ██╗██╗   ██╗████████╗███████╗    ██████╗ ███████╗ █████╗ ██╗"
echo "  ██╔════╝██║  ██║██║   ██║╚══██╔══╝██╔════╝    ██╔══██╗██╔════╝██╔══██╗██║"
echo "  ███████╗███████║██║   ██║   ██║   █████╗      ██████╔╝█████╗  ███████║██║"
echo "  ╚════██║██╔══██║██║   ██║   ██║   ██╔══╝      ██╔══██╗██╔══╝  ██╔══██║██║"
echo "  ███████║██║  ██║╚██████╔╝   ██║   ███████╗    ██║  ██║███████╗██║  ██║███████╗"
echo "  ╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚══════╝    ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝"
echo "                         TACTICAL COMBAT — installer"
echo ""

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ]
}

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

if ! node_ok; then
  echo "[1/3] Installing Node.js (needs sudo)..."
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm nodejs npm
  fi
fi
if ! node_ok; then
  echo ""
  echo "Node.js 18 or newer is required but was not found."
  echo "Install it from https://nodejs.org or with:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
echo "[1/3] Node.js $(node --version) OK"

echo "[2/3] Installing game files..."
if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund
else
  echo "npm not found. Install it with: sudo apt-get install -y npm"
  exit 1
fi

echo "[3/3] Adding the desktop launcher..."
chmod +x "$GAME_DIR/start.sh" "$GAME_DIR/server.sh" 2>/dev/null || true
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
cat > "$APPS/shute-real.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SHUTE REAL
GenericName=Tactical FPS
Comment=Realistic tactical shooter — solo vs bots and LAN/online multiplayer
Exec=$GAME_DIR/start.sh
Path=$GAME_DIR
Icon=$GAME_DIR/client/icon.svg
Terminal=false
Categories=Game;ActionGame;
Keywords=fps;shooter;multiplayer;tactical;
DESKTOP
chmod +x "$APPS/shute-real.desktop" 2>/dev/null || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

echo ""
echo "Done! Start the game with:   ./start.sh"
echo "(or find SHUTE REAL in your applications menu under Games)"
echo "Host a dedicated server with: ./server.sh"
echo ""

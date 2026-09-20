#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

ensure_node_24() {
  local current_major=""

  if command -v node >/dev/null 2>&1; then
    current_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  fi

  if [[ "$current_major" == "24" ]]; then
    return
  fi

  echo "Node.js 24 LTS is not available. Installing it with nvm..."

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  else
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL         https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh         | bash
    elif command -v wget >/dev/null 2>&1; then
      wget -qO-         https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh         | bash
    else
      fail "curl or wget is required so nvm can be installed."
    fi

    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
      fail "nvm installation completed but $NVM_DIR/nvm.sh was not found."
    fi

    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  fi

  nvm install 24
  nvm alias default 24
  nvm use 24

  current_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$current_major" != "24" ]]; then
    fail "Node.js 24 installation did not become active."
  fi

  echo "Using $(node --version) with npm $(npm --version)."
}

ensure_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    return
  fi

  echo "cloudflared is not installed. Installing a user-local copy..."

  local machine
  local asset
  local install_dir
  machine="$(uname -m)"

  case "$machine" in
    x86_64|amd64)
      asset="cloudflared-linux-amd64"
      ;;
    aarch64|arm64)
      asset="cloudflared-linux-arm64"
      ;;
    *)
      fail "Unsupported CPU architecture for automatic cloudflared install: $machine"
      ;;
  esac

  install_dir="$HOME/.local/bin"
  mkdir -p "$install_dir"

  if command -v curl >/dev/null 2>&1; then
    curl -fL       "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset"       -o "$install_dir/cloudflared"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$install_dir/cloudflared"       "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset"
  else
    fail "curl or wget is required so cloudflared can be installed."
  fi

  chmod 700 "$install_dir/cloudflared"
  export PATH="$install_dir:$PATH"

  command -v cloudflared >/dev/null 2>&1 ||
    fail "cloudflared installation failed."

  echo "Installed $(cloudflared --version | head -n 1)."
}

ensure_node_24
ensure_cloudflared

if ! command -v npm >/dev/null 2>&1; then
  fail "npm is unavailable after Node installation."
fi

if [[ ! -d node_modules ]]; then
  echo "Installing application dependencies..."
  npm install --no-audit --no-fund
fi

mkdir -p "$APP_DIR/data"
chmod 700 "$APP_DIR/data"

read -r -p "Permanent admin username [admin]: " admin_username
admin_username="${admin_username:-admin}"

if [[ ! "$admin_username" =~ ^[A-Za-z0-9_]{3,30}$ ]]; then
  fail "Admin username must be 3-30 letters, numbers, or underscores."
fi

while true; do
  read -r -s -p "Permanent admin password (12+ characters): " admin_password
  echo

  if (( ${#admin_password} < 12 )); then
    echo "Password must be at least 12 characters."
    continue
  fi

  read -r -s -p "Confirm admin password: " admin_password_confirm
  echo

  if [[ "$admin_password" != "$admin_password_confirm" ]]; then
    echo "Passwords did not match."
    continue
  fi

  break
done

export NODE_ENV=production
export HOST=127.0.0.1
export PORT=3000
export TRUST_PROXY=true
export COOKIE_SECURE=true
export DB_PATH="$APP_DIR/data/lofi_cafe.db"
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export ADMIN_USERNAME="$admin_username"
export ADMIN_PASSWORD="$admin_password"

app_log="$(mktemp)"
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi

  rm -f "$app_log"

  unset ADMIN_PASSWORD
  unset SESSION_SECRET
}
trap cleanup EXIT INT TERM

echo
echo "Starting Secure Lo-Fi Study Cafe..."
node server.js >"$app_log" 2>&1 &
app_pid="$!"

for _ in {1..30}; do
  if curl --fail --silent --max-time 2     "http://127.0.0.1:3000/healthz" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$app_log" >&2
    fail "The application stopped before becoming healthy."
  fi

  sleep 1
done

if ! curl --fail --silent --max-time 3   "http://127.0.0.1:3000/healthz" >/dev/null; then
  cat "$app_log" >&2
  fail "The application did not become healthy."
fi

echo "Local backend is healthy."
echo "Database: $DB_PATH"
echo
echo "Starting a FREE temporary Cloudflare Quick Tunnel..."
echo "Cloudflare will print a public URL similar to:"
echo "  https://random-words.trycloudflare.com"
echo
echo "Use that SAME URL on your computer and phone."
echo "Press Ctrl+C when you want to stop the public test."
echo
echo "NOTE: Quick Tunnels are for testing/development."
echo "For a stable production URL, use the named-tunnel/Caddy procedure in SELF-HOSTING.md."
echo

cloudflared tunnel --url "http://127.0.0.1:3000"

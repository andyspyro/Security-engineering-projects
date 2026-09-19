#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="secure-lofi-study-cafe"
SERVICE_USER="securelofi"
SERVICE_GROUP="securelofi"
APP_DIR="/opt/$APP_NAME"
DATA_DIR="/var/lib/$APP_NAME"
CONFIG_DIR="/etc/$APP_NAME"
BACKUP_DIR="/var/backups/$APP_NAME"
ENV_FILE="$CONFIG_DIR/secure-lofi.env"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "$EUID" -ne 0 ]]; then
  fail "Run this installer with sudo/root."
fi

if [[ ! -f "$SOURCE_DIR/package.json" || ! -f "$SOURCE_DIR/server.js" ]]; then
  fail "Could not locate the Secure Lo-Fi application source."
fi

command -v node >/dev/null 2>&1 || fail "Node.js 24 LTS is required before installation."
command -v npm >/dev/null 2>&1 || fail "npm is required before installation."

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 24 || node_major >= 27 )); then
  fail "Node.js 24 LTS is recommended/supported. Found: $(node --version)"
fi

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y     ca-certificates     curl     gzip     openssl     python3     build-essential     rsync     sqlite3
else
  for command_name in curl gzip openssl rsync sqlite3; do
    command -v "$command_name" >/dev/null 2>&1 ||
      fail "$command_name is required. Install it with your operating system package manager."
  done
fi

if ! getent group "$SERVICE_GROUP" >/dev/null; then
  groupadd --system "$SERVICE_GROUP"
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd     --system     --gid "$SERVICE_GROUP"     --home-dir "$DATA_DIR"     --shell /usr/sbin/nologin     "$SERVICE_USER"
fi

install -d -o root -g root -m 755 "$APP_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 700 "$DATA_DIR"
install -d -o root -g root -m 700 "$CONFIG_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 700 "$BACKUP_DIR"

rsync -a --delete   --exclude node_modules   --exclude data   --exclude .env   "$SOURCE_DIR/" "$APP_DIR/"

cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

chown -R root:root "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 755 {} +
find "$APP_DIR" -type f -exec chmod 644 {} +
chmod 755 "$APP_DIR"/deploy/scripts/*.sh

escape_env_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo
  echo "Choose how browsers will reach this server:"
  echo "  1) LAN only (phone/computer on the same local network)"
  echo "  2) HTTPS through Caddy or Cloudflare Tunnel"
  read -r -p "Mode [1/2, default 2]: " exposure_mode
  exposure_mode="${exposure_mode:-2}"

  if [[ "$exposure_mode" == "1" ]]; then
    host_value="0.0.0.0"
    trust_proxy_value="false"
    secure_cookie_value="false"
  elif [[ "$exposure_mode" == "2" ]]; then
    host_value="127.0.0.1"
    trust_proxy_value="true"
    secure_cookie_value="true"
  else
    fail "Invalid exposure mode."
  fi

  read -r -p "Permanent admin username [admin]: " admin_username
  admin_username="${admin_username:-admin}"

  if [[ ! "$admin_username" =~ ^[a-zA-Z0-9_]{3,30}$ ]]; then
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

  session_secret="$(openssl rand -hex 32)"

  cat > "$ENV_FILE" <<EOF
NODE_ENV="production"
HOST="$host_value"
PORT="3000"
TRUST_PROXY="$trust_proxy_value"
COOKIE_SECURE="$secure_cookie_value"
DB_PATH="$DATA_DIR/lofi_cafe.db"
SESSION_SECRET="$(escape_env_value "$session_secret")"
ADMIN_USERNAME="$(escape_env_value "$admin_username")"
ADMIN_PASSWORD="$(escape_env_value "$admin_password")"
EOF

  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
else
  echo "Preserving existing configuration: $ENV_FILE"
fi

install -o root -g root -m 644   "$APP_DIR/deploy/systemd/secure-lofi-study-cafe.service"   /etc/systemd/system/secure-lofi-study-cafe.service

install -o root -g root -m 644   "$APP_DIR/deploy/systemd/secure-lofi-backup.service"   /etc/systemd/system/secure-lofi-backup.service

install -o root -g root -m 644   "$APP_DIR/deploy/systemd/secure-lofi-backup.timer"   /etc/systemd/system/secure-lofi-backup.timer

systemctl daemon-reload
systemctl enable secure-lofi-study-cafe.service
systemctl enable --now secure-lofi-backup.timer
systemctl restart secure-lofi-study-cafe.service

sleep 2

if "$APP_DIR/deploy/scripts/healthcheck.sh"; then
  echo
  echo "Secure Lo-Fi Study Cafe is running."
else
  echo
  echo "The service started but the healthcheck failed."
  echo "Inspect logs with:"
  echo "  sudo journalctl -u secure-lofi-study-cafe -n 100 --no-pager"
  exit 1
fi

echo
echo "Service:"
echo "  sudo systemctl status secure-lofi-study-cafe"
echo "Logs:"
echo "  sudo journalctl -u secure-lofi-study-cafe -f"
echo "Configuration:"
echo "  $ENV_FILE"
echo "Database:"
echo "  $DATA_DIR/lofi_cafe.db"
echo "Backups:"
echo "  $BACKUP_DIR"
echo
echo "Review SELF-HOSTING.md before exposing the service beyond your LAN."

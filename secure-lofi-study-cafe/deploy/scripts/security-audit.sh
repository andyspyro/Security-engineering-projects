#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE="${SERVICE_NAME:-secure-lofi-study-cafe.service}"
DB_PATH="${DB_PATH:-/var/lib/secure-lofi-study-cafe/lofi_cafe.db}"
ENV_FILE="${ENV_FILE:-/etc/secure-lofi-study-cafe/secure-lofi.env}"

echo "== Secure Lo-Fi host security audit =="

echo
echo "[1/8] Service state"
systemctl is-enabled "$SERVICE"
systemctl is-active "$SERVICE"

echo
echo "[2/8] Service account"
systemctl show "$SERVICE"   --property=User   --property=Group   --property=NoNewPrivileges   --property=ProtectSystem   --property=ProtectHome   --property=PrivateTmp   --property=PrivateDevices

echo
echo "[3/8] Listening sockets"
ss -lntp | grep -E '(:3000|:80|:443)[[:space:]]' || true

echo
echo "[4/8] Secret/config permissions"
stat -c '%A %U:%G %n' "$ENV_FILE"

echo
echo "[5/8] Database permissions"
stat -c '%A %U:%G %n' "$DB_PATH"
stat -c '%A %U:%G %n' "$(dirname "$DB_PATH")"

echo
echo "[6/8] SQLite integrity and mode"
sqlite3 "$DB_PATH" "PRAGMA quick_check;"
sqlite3 "$DB_PATH" "PRAGMA journal_mode;"
sqlite3 "$DB_PATH" "PRAGMA foreign_keys;"

echo
echo "[7/8] Application health"
"$(dirname "$0")/healthcheck.sh"

echo
echo "[8/8] Firewall/systemd hardening"
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  echo "ufw not installed."
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze security "$SERVICE" --no-pager || true
fi

echo
echo "Audit complete."
echo "Review any unexpected public listener on port 3000, weak file permissions,"
echo "inactive firewall rules, failed quick_check output, or systemd hardening warnings."

#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this restore script with sudo/root." >&2
  exit 1
fi

BACKUP_FILE="${1:-}"
DB_PATH="${DB_PATH:-/var/lib/secure-lofi-study-cafe/lofi_cafe.db}"
SERVICE="${SERVICE_NAME:-secure-lofi-study-cafe.service}"
SERVICE_USER="${SERVICE_USER:-securelofi}"
SERVICE_GROUP="${SERVICE_GROUP:-securelofi}"

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Usage: sudo $0 /path/to/secure-lofi-YYYYMMDDTHHMMSSZ.db.gz" >&2
  exit 1
fi

checksum_file="$BACKUP_FILE.sha256"
if [[ -f "$checksum_file" ]]; then
  (
    cd "$(dirname "$BACKUP_FILE")"
    sha256sum --check "$(basename "$checksum_file")"
  )
else
  echo "Warning: checksum file not found; continuing with database integrity validation." >&2
fi

restore_tmp="$(mktemp --suffix=.db)"
cleanup() {
  rm -f "$restore_tmp"
}
trap cleanup EXIT

gzip -dc "$BACKUP_FILE" > "$restore_tmp"

integrity="$(sqlite3 "$restore_tmp" "PRAGMA quick_check;")"
if [[ "$integrity" != "ok" ]]; then
  echo "Backup failed SQLite quick_check: $integrity" >&2
  exit 1
fi

echo "Verified backup integrity."
echo "This will stop $SERVICE and replace $DB_PATH."
read -r -p "Type RESTORE to continue: " confirmation

if [[ "$confirmation" != "RESTORE" ]]; then
  echo "Restore cancelled."
  exit 1
fi

systemctl stop "$SERVICE"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
if [[ -f "$DB_PATH" ]]; then
  cp --preserve=mode,ownership,timestamps     "$DB_PATH" "$DB_PATH.pre-restore-$timestamp"
fi

rm -f "$DB_PATH-wal" "$DB_PATH-shm"
install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 600   "$restore_tmp" "$DB_PATH"

systemctl start "$SERVICE"
systemctl --no-pager --full status "$SERVICE"

echo "Restore completed successfully."

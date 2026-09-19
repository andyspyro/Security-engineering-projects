#!/usr/bin/env bash
set -Eeuo pipefail

DB_PATH="${DB_PATH:-/var/lib/secure-lofi-study-cafe/lofi_cafe.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/secure-lofi-study-cafe}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found: $DB_PATH" >&2
  exit 1
fi

command -v sqlite3 >/dev/null 2>&1 || {
  echo "sqlite3 CLI is required." >&2
  exit 1
}

command -v gzip >/dev/null 2>&1 || {
  echo "gzip is required." >&2
  exit 1
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
tmp_backup="$BACKUP_DIR/.secure-lofi-$timestamp.db.tmp"
final_backup="$BACKUP_DIR/secure-lofi-$timestamp.db.gz"
checksum_file="$final_backup.sha256"

cleanup() {
  rm -f "$tmp_backup"
}
trap cleanup EXIT

sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$tmp_backup'"

integrity="$(sqlite3 "$tmp_backup" "PRAGMA quick_check;")"
if [[ "$integrity" != "ok" ]]; then
  echo "Backup integrity check failed: $integrity" >&2
  exit 1
fi

chmod 600 "$tmp_backup"
gzip -9 -c "$tmp_backup" > "$final_backup"
chmod 600 "$final_backup"
sha256sum "$final_backup" > "$checksum_file"
chmod 600 "$checksum_file"

find "$BACKUP_DIR" -type f   \( -name 'secure-lofi-*.db.gz' -o -name 'secure-lofi-*.db.gz.sha256' \)   -mtime "+$RETENTION_DAYS" -delete

echo "Backup created: $final_backup"
echo "Integrity: ok"

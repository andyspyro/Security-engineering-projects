#!/usr/bin/env bash
set -Eeuo pipefail

URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"

response="$(curl --fail --silent --show-error --max-time 5 "$URL")"

if [[ "$response" != *'"status":"ok"'* ]] || [[ "$response" != *'"database":"reachable"'* ]]; then
  echo "Unexpected healthcheck response: $response" >&2
  exit 1
fi

echo "Secure Lo-Fi healthcheck passed: $response"

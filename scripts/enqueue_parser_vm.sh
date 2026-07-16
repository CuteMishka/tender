#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/cloud-user/tender1}"
RUN_MODE="${1:-parse}"
ENV_FILE="$APP_DIR/.env"

if [ ! -r "$ENV_FILE" ]; then
  echo "Cannot read $ENV_FILE" >&2
  exit 1
fi

case "$RUN_MODE" in
  parse)
    endpoint=/api/v1/parser/run
    ;;
  reanalyze_existing)
    endpoint=/api/v1/parser/reanalyze-existing
    ;;
  *)
    echo "Unsupported run mode: $RUN_MODE" >&2
    exit 2
    ;;
esac

token="$(sed -n 's/^BACKEND_INTERNAL_SERVICE_TOKEN=//p' "$ENV_FILE" | tail -n 1 | tr -d '\r')"
if [ "${#token}" -lt 32 ]; then
  echo "BACKEND_INTERNAL_SERVICE_TOKEN is missing or too short" >&2
  exit 1
fi

curl \
  --fail-with-body \
  --silent \
  --show-error \
  --connect-timeout 5 \
  --max-time 60 \
  --request POST \
  --header 'Accept: application/json' \
  --header 'X-User-Email: github-actions' \
  --header @<(printf 'X-Internal-Service-Token: %s\n' "$token") \
  "http://127.0.0.1:8082$endpoint"
unset token

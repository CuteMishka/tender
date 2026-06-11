#!/usr/bin/env bash
set -Eeuo pipefail

attempts="${HEALTHCHECK_ATTEMPTS:-30}"
delay="${HEALTHCHECK_DELAY_SECONDS:-5}"

check_url() {
  local name="$1"
  local url="$2"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 15 "$url" >/dev/null; then
      printf 'OK: %s (%s)\n' "$name" "$url"
      return 0
    fi
    sleep "$delay"
  done

  printf 'FAILED: %s (%s)\n' "$name" "$url" >&2
  return 1
}

check_url "frontend" "http://127.0.0.1/"
check_url "backend via port 80" "http://127.0.0.1/health"
check_url "backend via port 8082" "http://127.0.0.1:8082/health"
check_url "RAG API" "http://127.0.0.1:8083/health"

compose=(docker compose -p tender --env-file /etc/tender/tender.env -f /opt/tender/repo/docker-compose.prod.yml)
expected=(postgres rag-db backend rag-api parser llm frontend gateway)
running="$("${compose[@]}" ps --status running --services)"

for service in "${expected[@]}"; do
  if ! grep -qx "$service" <<<"$running"; then
    printf 'FAILED: Compose service is not running: %s\n' "$service" >&2
    "${compose[@]}" ps
    exit 1
  fi
done

printf 'All production checks passed.\n'

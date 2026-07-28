#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/cloud-user/tender1}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-tender-prod}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
admin_email="${1:-}"

if [ -z "$admin_email" ] || [[ "$admin_email" == *[[:space:]]* ]] ||
  [[ "$admin_email" != *@*.* ]] || [ "${#admin_email}" -gt 254 ]; then
  echo "A valid administrator email is required" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

compose=(
  sudo docker compose
  -p "$COMPOSE_PROJECT"
  --env-file "$ENV_FILE"
  -f "$APP_DIR/docker-compose.prod.yml"
  -f "$APP_DIR/docker-compose.ghcr.yml"
)

result="$(
  "${compose[@]}" exec -T \
    -e PSQL_ADMIN_EMAIL="$admin_email" \
    postgres sh -c '
      exec psql \
        -v ON_ERROR_STOP=1 \
        -v admin_email="$PSQL_ADMIN_EMAIL" \
        -Atq \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB"
    ' <<'SQL'
WITH candidate AS (
  SELECT id, email, password, name, company, position
  FROM registration_requests
  WHERE lower(email) = lower(:'admin_email')
    AND status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM users WHERE lower(users.email) = lower(:'admin_email')
    )
  ORDER BY id DESC
  LIMIT 1
),
inserted AS (
  INSERT INTO users (
    email, password_hash, name, role, company, position, status, created_at, updated_at
  )
  SELECT
    email, password, name, 'admin', company, position, 'active', now(), now()
  FROM candidate
  ON CONFLICT (email) DO NOTHING
  RETURNING email
),
updated AS (
  UPDATE registration_requests AS request
  SET status = 'approved', role = 'admin', password = '', updated_at = now()
  FROM inserted
  WHERE lower(request.email) = lower(inserted.email)
    AND request.status = 'pending'
  RETURNING request.id
)
SELECT
  (SELECT count(*) FROM inserted)::text || ':' ||
  (SELECT count(*) FROM updated)::text;
SQL
)"

if [ "$result" != "1:1" ]; then
  echo "No unique pending registration was promoted for $admin_email" >&2
  exit 1
fi

echo "Administrator account activated for $admin_email"

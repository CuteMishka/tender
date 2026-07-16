#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/home/cloud-user/tender1}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-tender-prod}"
LEGACY_PROJECT="${LEGACY_PROJECT:-cloud-user}"
GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:?GHCR_IMAGE_PREFIX is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/tender}"
DEPLOYED_AT="$(date -u +%Y%m%dT%H%M%SZ)"
LEGACY_MANIFEST="$BACKUP_ROOT/legacy-cutover-${DEPLOYED_AT}.tsv"

if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "IMAGE_TAG is not a valid Docker tag" >&2
  exit 1
fi

cd "$APP_DIR"

# Keep the nested volume mountpoint present on the host.  The image cannot
# create it at runtime because /files is a read-only bind mount in production.
sudo install -d -m 0755 "$APP_DIR/tender-rag/files/generated"

required_files=(
  .env
  docker-compose.prod.yml
  docker-compose.ghcr.yml
  ops/nginx/conf.d/00-tender-hardening.conf
  ops/nginx/snippets/tender-proxy.conf
  ops/nginx/snippets/tender-security-headers.conf
  ops/nginx/sites-available/qolab.kz.conf
  ops/backup/tender-backup.sh
  ops/systemd/tender-backup.service
  ops/systemd/tender-backup.timer
)
for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Required deployment file is missing: $APP_DIR/$file" >&2
    exit 1
  fi
done

chmod 600 .env

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" .env | tail -n 1 | tr -d '\r'
}

require_env() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  if [ -z "$value" ]; then
    echo "$key is missing or empty in $APP_DIR/.env" >&2
    exit 1
  fi
}

require_env POSTGRES_PASSWORD
require_env RAG_POSTGRES_PASSWORD
require_env TENDERPLUS_TOKEN
require_env BACKEND_INTERNAL_SERVICE_TOKEN
require_env RAG_INTERNAL_SERVICE_TOKEN

postgres_password="$(env_value POSTGRES_PASSWORD)"
rag_password="$(env_value RAG_POSTGRES_PASSWORD)"
backend_internal_token="$(env_value BACKEND_INTERNAL_SERVICE_TOKEN)"
rag_internal_token="$(env_value RAG_INTERNAL_SERVICE_TOKEN)"
legacy_internal_token="$(env_value INTERNAL_SERVICE_TOKEN)"
if [ "${#postgres_password}" -lt 16 ] || [ "$postgres_password" = "tender" ] || [[ "$postgres_password" == change-me* ]]; then
  echo "POSTGRES_PASSWORD must be a rotated value of at least 16 characters" >&2
  exit 1
fi
if [ "${#rag_password}" -lt 16 ] || [ "$rag_password" = "rag" ] || [[ "$rag_password" == change-me* ]]; then
  echo "RAG_POSTGRES_PASSWORD must be a rotated value of at least 16 characters" >&2
  exit 1
fi
if [ "${#backend_internal_token}" -lt 32 ] || [[ "$backend_internal_token" == replace-with-* ]]; then
  echo "BACKEND_INTERNAL_SERVICE_TOKEN must contain at least 32 random characters" >&2
  exit 1
fi
if [ "${#rag_internal_token}" -lt 32 ] || [[ "$rag_internal_token" == replace-with-* ]]; then
  echo "RAG_INTERNAL_SERVICE_TOKEN must contain at least 32 random characters" >&2
  exit 1
fi
if [ "$backend_internal_token" = "$rag_internal_token" ]; then
  echo "BACKEND_INTERNAL_SERVICE_TOKEN and RAG_INTERNAL_SERVICE_TOKEN must be distinct" >&2
  exit 1
fi
if [ -n "$legacy_internal_token" ]; then
  echo "Remove legacy INTERNAL_SERVICE_TOKEN; shared-token fallback is not supported" >&2
  exit 1
fi
unset postgres_password rag_password backend_internal_token rag_internal_token legacy_internal_token

if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "Docker Compose is not installed" >&2
  exit 1
fi

compose=(
  sudo env
  "GHCR_IMAGE_PREFIX=$GHCR_IMAGE_PREFIX"
  "IMAGE_TAG=$IMAGE_TAG"
  "${compose_cmd[@]}"
  --project-name "$COMPOSE_PROJECT"
  -f docker-compose.prod.yml
  -f docker-compose.ghcr.yml
  --env-file .env
)

echo "Validating the production Compose model..."
"${compose[@]}" config --quiet

echo "Pulling immutable application tag $IMAGE_TAG from $GHCR_IMAGE_PREFIX..."
"${compose[@]}" pull backend parser rag-api frontend

sudo install -d -m 0700 -o root -g root "$BACKUP_ROOT"

declare -A LEGACY_IDS=()
PRIMARY_CUTOVER=false
LEGACY_STOPPED=false
NEW_PROJECT_STARTED=false

project_service_ids() {
  local project="$1"
  local service="$2"
  local state="${3:-all}"
  local args=(ps -aq)
  if [ "$state" = "running" ]; then
    args=(ps -q --filter status=running)
  fi
  sudo docker "${args[@]}" \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service"
}

project_container_ids() {
  local project="$1"
  local state="${2:-all}"
  local args=(ps -aq)
  if [ "$state" = "running" ]; then
    args=(ps -q --filter status=running)
  fi
  sudo docker "${args[@]}" --filter "label=com.docker.compose.project=$project"
}

container_env_value() {
  local container="$1"
  local key="$2"
  sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" \
    | sed -n "s/^${key}=//p" | tail -n 1
}

assert_named_volume() {
  local container="$1"
  local volume="$2"
  local destination="$3"
  local mounts
  mounts="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{printf "%s\t%s\n" .Name .Destination}}{{end}}{{end}}' "$container")"
  if ! grep -Fqx "$volume"$'\t'"$destination" <<<"$mounts"; then
    echo "Container $container does not mount $volume at $destination" >&2
    exit 1
  fi
}

single_running_service_container() {
  local project="$1"
  local service="$2"
  local -a containers=()
  mapfile -t containers < <(project_service_ids "$project" "$service" running)
  if [ "${#containers[@]}" -ne 1 ]; then
    echo "Expected exactly one running $project/$service container, found ${#containers[@]}" >&2
    return 1
  fi
  printf '%s\n' "${containers[0]}"
}

write_legacy_manifest() {
  local service details
  {
    printf 'service\tcontainer_id\tname\tconfigured_image\timage_id\tstate\n'
    for service in postgres rag-db llm backend rag-api parser frontend; do
      details="$(sudo docker inspect --format '{{printf "%s\t%s\t%s\t%s\t%s" .Id .Name .Config.Image .Image .State.Status}}' "${LEGACY_IDS[$service]}")"
      printf '%s\t%s\n' "$service" "$details"
    done
  } | sudo tee "$LEGACY_MANIFEST" >/dev/null
  sudo chmod 0600 "$LEGACY_MANIFEST"
  sudo test -s "$LEGACY_MANIFEST"
}

discover_cutover_source() {
  local service state
  local -a canonical=() legacy_all=() legacy_running=() service_ids=()
  mapfile -t canonical < <(project_container_ids "$COMPOSE_PROJECT" all)
  mapfile -t legacy_all < <(project_container_ids "$LEGACY_PROJECT" all)
  mapfile -t legacy_running < <(project_container_ids "$LEGACY_PROJECT" running)

  if [ "${#canonical[@]}" -gt 0 ]; then
    if [ "${#legacy_running[@]}" -gt 0 ]; then
      echo "Canonical and legacy projects both have running containers; refusing an ambiguous cutover" >&2
      exit 1
    fi
    BACKUP_SOURCE_PROJECT="$COMPOSE_PROJECT"
    return
  fi

  if [ "${#legacy_all[@]}" -eq 0 ]; then
    echo "Neither $COMPOSE_PROJECT nor $LEGACY_PROJECT has containers to back up" >&2
    exit 1
  fi

  PRIMARY_CUTOVER=true
  BACKUP_SOURCE_PROJECT="$LEGACY_PROJECT"
  for service in postgres rag-db llm backend rag-api parser frontend; do
    mapfile -t service_ids < <(project_service_ids "$LEGACY_PROJECT" "$service" all)
    if [ "${#service_ids[@]}" -ne 1 ]; then
      echo "Expected exactly one legacy $service container, found ${#service_ids[@]}" >&2
      exit 1
    fi
    state="$(sudo docker inspect --format '{{.State.Status}}' "${service_ids[0]}")"
    if [ "$state" != "running" ]; then
      echo "Legacy $service container is $state; rollback set must be fully running before cutover" >&2
      exit 1
    fi
    LEGACY_IDS[$service]="${service_ids[0]}"
  done

  assert_named_volume "${LEGACY_IDS[postgres]}" cloud-user_tender_postgres_data /var/lib/postgresql/data
  assert_named_volume "${LEGACY_IDS[rag-db]}" cloud-user_rag_postgres_data /var/lib/postgresql/data
  assert_named_volume "${LEGACY_IDS[parser]}" cloud-user_parser_downloads /app/downloads
  assert_named_volume "${LEGACY_IDS[llm]}" cloud-user_ollama_data /root/.ollama

  # A stopped legacy container cannot be a rollback target after role-password
  # rotation if its preserved environment still contains the old password.
  if [ "$(container_env_value "${LEGACY_IDS[postgres]}" POSTGRES_PASSWORD)" != "$(env_value POSTGRES_PASSWORD)" ]; then
    echo "Legacy PostgreSQL credentials differ from .env; recreate a rollback target with the rotated credential before cutover" >&2
    exit 1
  fi
  if [ "$(container_env_value "${LEGACY_IDS[rag-db]}" POSTGRES_PASSWORD)" != "$(env_value RAG_POSTGRES_PASSWORD)" ]; then
    echo "Legacy RAG PostgreSQL credentials differ from .env; recreate a rollback target with the rotated credential before cutover" >&2
    exit 1
  fi

  write_legacy_manifest
}

discover_cutover_source

backup_database() {
  local project="$1"
  local service="$2"
  local expected_volume="$3"
  local output="$4"
  local container
  container="$(single_running_service_container "$project" "$service")"
  assert_named_volume "$container" "$expected_volume" /var/lib/postgresql/data
  sudo docker exec "$container" sh -ec \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
    | sudo tee "$output" >/dev/null
  sudo chmod 0600 "$output"
  sudo test -s "$output"
  # Keep the file read and redirection inside the privileged shell.  A
  # pipeline here can report 141 when pg_restore exits after reading its
  # archive metadata, even though the archive is valid.
  sudo sh -c "docker exec -i '$container' pg_restore --list < '$output' >/dev/null"
}

echo "Creating pre-deploy logical database backups..."
backup_database "$BACKUP_SOURCE_PROJECT" postgres cloud-user_tender_postgres_data "$BACKUP_ROOT/tender-${DEPLOYED_AT}.dump"
backup_database "$BACKUP_SOURCE_PROJECT" rag-db cloud-user_rag_postgres_data "$BACKUP_ROOT/rag-${DEPLOYED_AT}.dump"
sudo find "$BACKUP_ROOT" -maxdepth 1 -type f -name '*.dump' -mtime +14 -delete

NGINX_BACKUP="$BACKUP_ROOT/nginx-${DEPLOYED_AT}"
NGINX_RESTORE_REQUIRED=false

restore_nginx() {
  local directory
  echo "Restoring the previous Nginx tree from $NGINX_BACKUP" >&2
  sudo rm -f \
    /etc/nginx/conf.d/00-tender-hardening.conf \
    /etc/nginx/snippets/tender-proxy.conf \
    /etc/nginx/snippets/tender-security-headers.conf \
    /etc/nginx/sites-available/qolab.kz.conf \
    /etc/nginx/sites-enabled/qolab.kz.conf
  for directory in conf.d snippets sites-available sites-enabled; do
    sudo cp -a "$NGINX_BACKUP/$directory/." "/etc/nginx/$directory/"
  done
  NGINX_RESTORE_REQUIRED=false
  if sudo nginx -t; then
    sudo systemctl reload nginx || echo "WARNING: restored Nginx files, but reload failed" >&2
  else
    echo "WARNING: the restored Nginx tree did not pass nginx -t" >&2
  fi
}

wait_for_container() {
  local container="$1"
  local state health
  for _ in $(seq 1 60); do
    state="$(sudo docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)"
    health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
    if [ "$state" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "none" ]; }; then
      return 0
    fi
    sleep 2
  done
  echo "Container $container did not become ready during rollback" >&2
  return 1
}

restart_legacy() {
  local service
  echo "Restarting preserved legacy rollback containers..." >&2
  for service in postgres rag-db llm; do
    sudo docker start "${LEGACY_IDS[$service]}" >/dev/null
  done
  for service in postgres rag-db llm; do
    wait_for_container "${LEGACY_IDS[$service]}" || return 1
  done
  for service in rag-api backend frontend parser; do
    sudo docker start "${LEGACY_IDS[$service]}" >/dev/null
  done
  for service in rag-api backend frontend parser; do
    wait_for_container "${LEGACY_IDS[$service]}" || return 1
  done
  for _ in $(seq 1 60); do
    if curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:8082/health >/dev/null \
      && curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:8083/health >/dev/null \
      && curl --connect-timeout 2 --max-time 5 -fsS http://127.0.0.1:18080/ >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "Legacy HTTP endpoints did not recover" >&2
  return 1
}

deployment_failure() {
  local status="${1:-$?}"
  trap - ERR EXIT
  set +e
  if [ "$NEW_PROJECT_STARTED" = true ]; then
    echo "Stopping failed $COMPOSE_PROJECT deployment without deleting volumes..." >&2
    "${compose[@]}" down --remove-orphans
    NEW_PROJECT_STARTED=false
  fi
  if [ "$PRIMARY_CUTOVER" = true ] && [ "$LEGACY_STOPPED" = true ]; then
    restart_legacy || echo "WARNING: automatic legacy restart failed; use $LEGACY_MANIFEST from the provider console" >&2
  fi
  if [ "$NGINX_RESTORE_REQUIRED" = true ]; then
    restore_nginx
  fi
  exit "$status"
}

deployment_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    deployment_failure "$status"
  fi
}

trap deployment_failure ERR
trap deployment_exit EXIT

stage_nginx() {
  sudo install -d -m 0700 -o root -g root "$NGINX_BACKUP"
  for directory in conf.d snippets sites-available sites-enabled; do
    sudo cp -a "/etc/nginx/$directory" "$NGINX_BACKUP/$directory"
  done
  NGINX_RESTORE_REQUIRED=true

  sudo rm -f \
    /etc/nginx/conf.d/qolab-connection-upgrade.conf \
    /etc/nginx/conf.d/qolab-proxy-timeouts.conf \
    /etc/nginx/sites-enabled/default \
    /etc/nginx/sites-enabled/qolab.kz.conf

  sudo install -D -m 0644 -o root -g root \
    ops/nginx/conf.d/00-tender-hardening.conf \
    /etc/nginx/conf.d/00-tender-hardening.conf
  sudo install -D -m 0644 -o root -g root \
    ops/nginx/snippets/tender-proxy.conf \
    /etc/nginx/snippets/tender-proxy.conf
  sudo install -D -m 0644 -o root -g root \
    ops/nginx/snippets/tender-security-headers.conf \
    /etc/nginx/snippets/tender-security-headers.conf
  sudo install -D -m 0644 -o root -g root \
    ops/nginx/sites-available/qolab.kz.conf \
    /etc/nginx/sites-available/qolab.kz.conf
  sudo ln -s /etc/nginx/sites-available/qolab.kz.conf /etc/nginx/sites-enabled/qolab.kz.conf

  if ! sudo nginx -t; then
    echo "New Nginx configuration is invalid" >&2
    return 1
  fi
}

echo "Staging and validating the hardened Nginx configuration..."
stage_nginx

if [ "$PRIMARY_CUTOVER" = true ]; then
  echo "Stopping legacy Tender containers while preserving the rollback set..."
  LEGACY_STOPPED=true
  for service in frontend parser backend rag-api llm rag-db postgres; do
    sudo docker stop --time 45 "${LEGACY_IDS[$service]}" >/dev/null
  done
else
  echo "Stopping the previous canonical project containers..."
  "${compose[@]}" down --remove-orphans
fi

echo "Starting databases and Ollama on private Docker networks..."
NEW_PROJECT_STARTED=true
if [ "$PRIMARY_CUTOVER" = true ]; then
  # The provider currently presents an invalid certificate for Docker Hub.
  # Reuse the image already held by the preserved legacy Ollama container so
  # a cutover never depends on an outbound Docker Hub pull.
  legacy_llm_image="$(sudo docker inspect --format '{{.Image}}' "${LEGACY_IDS[llm]}" 2>/dev/null || true)"
  target_ollama_tag="$(env_value OLLAMA_IMAGE_TAG)"
  target_ollama_tag="${target_ollama_tag:-0.30.0}"
  if [ -z "$legacy_llm_image" ]; then
    echo "The preserved legacy Ollama image is unavailable" >&2
    exit 1
  fi
  sudo docker tag "$legacy_llm_image" "ollama/ollama:$target_ollama_tag"
  unset legacy_llm_image target_ollama_tag
fi
"${compose[@]}" up -d --pull never --no-build --remove-orphans postgres rag-db llm

echo "Ensuring the configured local model exists..."
llm_container="$("${compose[@]}" ps -q llm)"
if [ -n "$llm_container" ]; then
  if ! sudo docker exec "$llm_container" ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -Fxq 'qwen2.5:3b'; then
    sudo docker exec "$llm_container" ollama pull qwen2.5:3b
  else
    echo "Configured local model qwen2.5:3b is already present; skipping download."
  fi
fi

echo "Starting the internal APIs, frontend and parser..."
"${compose[@]}" up -d --pull never --no-build --remove-orphans rag-api backend frontend parser

echo "Waiting for loopback-only service health..."
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8082/health >/dev/null \
    && curl -fsS http://127.0.0.1:8083/health >/dev/null \
    && curl -fsS http://127.0.0.1:18080/ >/dev/null; then
    break
  fi
  sleep 3
done
curl -fsS http://127.0.0.1:8082/health >/dev/null
curl -fsS http://127.0.0.1:8083/health >/dev/null
curl -fsS http://127.0.0.1:18080/ >/dev/null

unauthenticated_status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8082/api/v1/tenders)"
if [ "$unauthenticated_status" != "401" ]; then
  echo "Protected backend route returned $unauthenticated_status instead of 401" >&2
  exit 1
fi

echo "Reloading Nginx only after all upstreams passed health checks..."
sudo nginx -t
sudo systemctl reload nginx

# This VPS provider does not support hairpin access to the instance's own
# public address.  Exercise the real TLS vhost and certificate locally; the
# workflow runner performs the external reachability check separately.
local_health_status="$(curl --noproxy '*' -k -sS -o /dev/null -w '%{http_code}' -H 'Host: qolab.kz' https://127.0.0.1/healthz || true)"
public_api_status="$(curl --noproxy '*' -k -sS -o /dev/null -w '%{http_code}' -H 'Host: qolab.kz' https://127.0.0.1/api/v1/tenders || true)"
public_rag_status="$(curl --noproxy '*' -k -sS -o /dev/null -w '%{http_code}' -H 'Host: qolab.kz' https://127.0.0.1/rag/health || true)"
if [ "$local_health_status" != "200" ]; then
  echo "WARNING: local TLS health endpoint returned ${local_health_status:-no response}; nginx syntax and internal upstream checks passed." >&2
fi
if [ "$public_api_status" != "401" ]; then
  echo "WARNING: local protected API returned ${public_api_status:-no response} (expected 401)." >&2
fi
if [ "$public_rag_status" != "404" ]; then
  echo "WARNING: local direct RAG route returned ${public_rag_status:-no response} (expected 404)." >&2
fi
echo "Installing and exercising the daily logical backup timer..."
sudo install -D -m 0750 -o root -g root \
  ops/backup/tender-backup.sh /usr/local/sbin/tender-backup
sudo install -D -m 0644 -o root -g root \
  ops/systemd/tender-backup.service /etc/systemd/system/tender-backup.service
sudo install -D -m 0644 -o root -g root \
  ops/systemd/tender-backup.timer /etc/systemd/system/tender-backup.timer
sudo systemctl daemon-reload
sudo systemctl start tender-backup.service
sudo systemctl enable --now tender-backup.timer
sudo systemctl is-active --quiet tender-backup.timer

echo "Verifying that internal listeners are loopback-only..."
if sudo ss -ltnH | awk '$4 ~ /:(5433|5434|8082|8083|11434|18080)$/ {print $4}' \
  | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | grep -q .; then
  echo "An internal Tender port is still listening outside loopback" >&2
  sudo ss -ltnp | grep -E ':(5433|5434|8082|8083|11434|18080)\b' || true
  exit 1
fi
if sudo ss -ltnH | awk '$4 ~ /:(5433|5434|11434)$/ {print $4}' | grep -q .; then
  echo "A database or Ollama port is unexpectedly published on the host" >&2
  sudo ss -ltnp | grep -E ':(5433|5434|11434)\b' || true
  exit 1
fi

NGINX_RESTORE_REQUIRED=false
NEW_PROJECT_STARTED=false
trap - ERR EXIT

echo "Containers:"
"${compose[@]}" ps
echo "GHCR deploy completed: $GHCR_IMAGE_PREFIX:$IMAGE_TAG"
echo "Pre-deploy backups: $BACKUP_ROOT/*-${DEPLOYED_AT}.dump"
echo "Previous Nginx tree: $NGINX_BACKUP"
if [ "$PRIMARY_CUTOVER" = true ]; then
  echo "Legacy rollback containers remain stopped and must not be deleted before external acceptance: $LEGACY_MANIFEST"
fi

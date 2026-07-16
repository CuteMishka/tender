#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/home/cloud-user/tender1}"
MARKER="${ROTATION_MARKER:-/var/lib/tender/db-credentials-rotated-v2}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/tender}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root" >&2
  exit 1
fi
if [ -f "$MARKER" ]; then
  echo "Database credentials were already rotated; leaving them unchanged."
  exit 0
fi

canonical_env="$APP_DIR/.env"
if [ ! -f "$canonical_env" ]; then
  echo "Missing canonical environment file: $canonical_env" >&2
  exit 1
fi

env_value() {
  local file="$1" key="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d '\r'
}

replace_env_value() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i -E "s|^${key}=.*$|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
  chmod 600 "$file"
}

is_weak() {
  local value="$1"
  [ "${#value}" -lt 16 ] || [ "$value" = "tender" ] || [ "$value" = "rag" ] || [[ "$value" == change-me* ]]
}

current_pg="$(env_value "$canonical_env" POSTGRES_PASSWORD)"
current_rag="$(env_value "$canonical_env" RAG_POSTGRES_PASSWORD)"
credentials_already_strong=false
if ! is_weak "$current_pg" && ! is_weak "$current_rag"; then
  credentials_already_strong=true
fi

legacy_project="${LEGACY_PROJECT:-cloud-user}"
legacy_container="$(sudo docker ps -q --filter "label=com.docker.compose.project=$legacy_project" --filter 'label=com.docker.compose.service=postgres' | head -n 1)"
legacy_rag_container="$(sudo docker ps -q --filter "label=com.docker.compose.project=$legacy_project" --filter 'label=com.docker.compose.service=rag-db' | head -n 1)"
if [ -z "$legacy_container" ] || [ -z "$legacy_rag_container" ]; then
  echo "Healthy legacy PostgreSQL containers are required for credential rotation" >&2
  exit 1
fi

container_env() {
  local container="$1" key="$2"
  sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" \
    | sed -n "s/^${key}=//p" | tail -n 1
}

old_pg="$(container_env "$legacy_container" POSTGRES_PASSWORD)"
old_rag="$(container_env "$legacy_rag_container" POSTGRES_PASSWORD)"
pg_user="$(container_env "$legacy_container" POSTGRES_USER)"
pg_db="$(container_env "$legacy_container" POSTGRES_DB)"
rag_user="$(container_env "$legacy_rag_container" POSTGRES_USER)"
rag_db="$(container_env "$legacy_rag_container" POSTGRES_DB)"
for value in "$old_pg" "$old_rag" "$pg_user" "$pg_db" "$rag_user" "$rag_db"; do
  [ -n "$value" ] || { echo "Legacy database container metadata is incomplete" >&2; exit 1; }
done

if [ "$credentials_already_strong" = true ]; then
  new_pg="$current_pg"
  new_rag="$current_rag"
else
  new_pg="$(openssl rand -hex 32)"
  new_rag="$(openssl rand -hex 32)"
fi
legacy_dir="$(sudo docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$legacy_container")"
legacy_config="$(sudo docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$legacy_container")"
legacy_env="$legacy_dir/.env"
[ -f "$legacy_env" ] || legacy_env="$canonical_env"

backup_dir="$BACKUP_ROOT/credential-rotation-$STAMP"
install -d -m 0700 "$backup_dir"
cp -a "$canonical_env" "$backup_dir/canonical.env"
if [ "$legacy_env" != "$canonical_env" ] && [ -f "$legacy_env" ]; then
  cp -a "$legacy_env" "$backup_dir/legacy.env"
fi

alter_role() {
  local container="$1" old_password="$2" user="$3" database="$4" new_password="$5"
  printf 'ALTER ROLE "%s" PASSWORD '\''%s'\'';\n' "$user" "$new_password" \
    | sudo docker exec -i -e "PGPASSWORD=$old_password" "$container" \
        psql -v ON_ERROR_STOP=1 -U "$user" -d "$database" >/dev/null
}

if [ "$credentials_already_strong" != true ]; then
  alter_role "$legacy_container" "$old_pg" "$pg_user" "$pg_db" "$new_pg"
  alter_role "$legacy_rag_container" "$old_rag" "$rag_user" "$rag_db" "$new_rag"
fi

replace_env_value "$canonical_env" POSTGRES_PASSWORD "$new_pg"
replace_env_value "$canonical_env" RAG_POSTGRES_PASSWORD "$new_rag"
if [ "$legacy_env" != "$canonical_env" ]; then
  replace_env_value "$legacy_env" POSTGRES_PASSWORD "$new_pg"
  replace_env_value "$legacy_env" RAG_POSTGRES_PASSWORD "$new_rag"
fi

if [ -z "$legacy_config" ]; then
  legacy_config="$legacy_dir/docker-compose.yml"
fi
IFS=',' read -r -a config_files <<< "$legacy_config"
compose=(sudo docker compose --project-name "$legacy_project")
for config_file in "${config_files[@]}"; do
  [ -f "$config_file" ] || config_file="$legacy_dir/$config_file"
  compose+=(--file "$config_file")
done
compose+=(--env-file "$legacy_env")
# Only recreate services that carry database credentials.  Pulling the whole
# legacy stack would unnecessarily fetch the old Ollama image from Docker Hub
# and could fail on a restricted outbound registry path.
"${compose[@]}" up -d --no-build --pull never --no-deps postgres rag-db backend parser rag-api frontend >/dev/null

for service in postgres rag-db; do
  if [ "$(sudo docker ps -q --filter "label=com.docker.compose.project=$legacy_project" --filter "label=com.docker.compose.service=$service" | wc -l)" -ne 1 ]; then
    echo "Legacy $service did not restart after credential rotation" >&2
    exit 1
  fi
done

legacy_container="$(sudo docker ps -q --filter "label=com.docker.compose.project=$legacy_project" --filter 'label=com.docker.compose.service=postgres' | head -n 1)"
legacy_rag_container="$(sudo docker ps -q --filter "label=com.docker.compose.project=$legacy_project" --filter 'label=com.docker.compose.service=rag-db' | head -n 1)"
if [ "$(container_env "$legacy_container" POSTGRES_PASSWORD)" != "$new_pg" ] || \
   [ "$(container_env "$legacy_rag_container" POSTGRES_PASSWORD)" != "$new_rag" ]; then
  echo "Legacy database container environments did not receive the rotated credentials" >&2
  exit 1
fi
sudo docker exec -e "PGPASSWORD=$new_pg" "$legacy_container" \
  psql -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" -c 'SELECT 1' >/dev/null
sudo docker exec -e "PGPASSWORD=$new_rag" "$legacy_rag_container" \
  psql -v ON_ERROR_STOP=1 -U "$rag_user" -d "$rag_db" -c 'SELECT 1' >/dev/null

install -d -m 0700 "$(dirname "$MARKER")"
printf '%s\n' "$STAMP" > "$MARKER"
chmod 600 "$MARKER"
echo "Database role credentials rotated; backup: $backup_dir"

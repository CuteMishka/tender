#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tender/daily}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PROJECT="${COMPOSE_PROJECT:-tender-prod}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

exec 9>/run/lock/tender-backup.lock
flock -n 9 || {
  echo "Another Tender backup is already running" >&2
  exit 1
}

install -d -m 0700 -o root -g root "$BACKUP_DIR"
workdir="$(mktemp -d "$BACKUP_DIR/.incomplete-${STAMP}.XXXXXX")"
trap 'rm -rf -- "$workdir"' EXIT

container_for() {
  local service="$1"
  local expected_volume="$2"
  local health mounts
  local -a containers=()
  mapfile -t containers < <(docker ps -q \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$service" \
    --filter status=running)
  if [ "${#containers[@]}" -ne 1 ]; then
    echo "Expected exactly one running $PROJECT/$service container, found ${#containers[@]}" >&2
    return 1
  fi
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${containers[0]}")"
  if [ "$health" != "healthy" ]; then
    echo "$PROJECT/$service is not healthy (state: $health)" >&2
    return 1
  fi
  mounts="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{printf "%s\t%s\n" .Name .Destination}}{{end}}{{end}}' "${containers[0]}")"
  if ! grep -Fqx "$expected_volume"$'\t'"/var/lib/postgresql/data" <<<"$mounts"; then
    echo "$PROJECT/$service does not use expected volume $expected_volume" >&2
    return 1
  fi
  printf '%s\n' "${containers[0]}"
}

dump_service() {
  local service="$1"
  local name="$2"
  local expected_volume="$3"
  local container output
  container="$(container_for "$service" "$expected_volume")"
  output="$workdir/${name}-${STAMP}.dump"
  docker exec "$container" sh -ec \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
    >"$output"
  test -s "$output"
  docker exec -i "$container" pg_restore --list <"$output" >/dev/null
}

dump_service postgres tender cloud-user_tender_postgres_data
dump_service rag-db rag cloud-user_rag_postgres_data

(cd "$workdir" && sha256sum -- *.dump >"SHA256SUMS-$STAMP")
chmod 0600 "$workdir"/*
mv "$workdir"/* "$BACKUP_DIR/"
rmdir "$workdir"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name 'SHA256SUMS-*' \) -mtime "+$RETENTION_DAYS" -delete

# Optional encrypted off-site copy. /etc/tender/backup.env should provide
# RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE (plus provider credentials).
if command -v restic >/dev/null 2>&1 && [ -n "${RESTIC_REPOSITORY:-}" ]; then
  restic backup "$BACKUP_DIR"
  restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune
  restic check --read-data-subset=1/20
fi

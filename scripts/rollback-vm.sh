#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="${TENDER_REPO_DIR:-/opt/tender/repo}"
env_file="${TENDER_ENV_FILE:-/etc/tender/tender.env}"
state_file="${TENDER_STATE_DIR:-/opt/tender/state}/last-successful"
target="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo /usr/local/sbin/tender-rollback [sha]" >&2
  exit 1
fi

if [[ -z "$target" ]]; then
  if [[ ! -s "$state_file" ]]; then
    echo "No last successful revision is recorded." >&2
    exit 1
  fi
  target="$(<"$state_file")"
fi

cd "$repo_dir"
git fetch --prune origin
git checkout --detach "${target}^{commit}"

compose=(docker compose -p tender --env-file "$env_file" -f "$repo_dir/docker-compose.prod.yml")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --remove-orphans --wait --wait-timeout 300
"$repo_dir/scripts/healthcheck-vm.sh"

printf '%s\n' "$(git rev-parse HEAD)" >"$state_file"
echo "Rollback successful: $(git rev-parse HEAD)"

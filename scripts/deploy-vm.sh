#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="${TENDER_REPO_DIR:-/opt/tender/repo}"
env_file="${TENDER_ENV_FILE:-/etc/tender/tender.env}"
state_dir="${TENDER_STATE_DIR:-/opt/tender/state}"
ref="${1:-main}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo /usr/local/sbin/tender-deploy [branch|tag|sha]" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "Missing production environment file: $env_file" >&2
  exit 1
fi

mkdir -p "$state_dir"
chmod 700 "$(dirname "$env_file")"
chmod 600 "$env_file"

cd "$repo_dir"
git fetch --prune origin

resolve_ref() {
  local requested="$1"
  if git rev-parse --verify --quiet "${requested}^{commit}" >/dev/null; then
    git rev-parse "${requested}^{commit}"
  elif git rev-parse --verify --quiet "origin/${requested}^{commit}" >/dev/null; then
    git rev-parse "origin/${requested}^{commit}"
  else
    echo "Unknown Git ref: $requested" >&2
    return 1
  fi
}

previous="$(git rev-parse HEAD)"
target="$(resolve_ref "$ref")"
compose=(docker compose -p tender --env-file "$env_file" -f "$repo_dir/docker-compose.prod.yml")

rollback() {
  local failed_status=$?
  echo "Deployment failed. Rolling back to $previous" >&2
  git checkout --detach "$previous"
  "${compose[@]}" up -d --build --remove-orphans --wait --wait-timeout 300 || true
  "$repo_dir/scripts/healthcheck-vm.sh" || true
  exit "$failed_status"
}
trap rollback ERR

git checkout --detach "$target"

install -m 0755 "$repo_dir/scripts/deploy-vm.sh" /usr/local/sbin/tender-deploy
install -m 0755 "$repo_dir/scripts/rollback-vm.sh" /usr/local/sbin/tender-rollback
install -m 0755 "$repo_dir/scripts/healthcheck-vm.sh" /usr/local/sbin/tender-health
install -m 0644 "$repo_dir/deploy/systemd/tender-stack.service" /etc/systemd/system/tender-stack.service
systemctl daemon-reload

"${compose[@]}" config --quiet
"${compose[@]}" build --pull
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 300
"$repo_dir/scripts/healthcheck-vm.sh"

printf '%s\n' "$target" >"$state_dir/last-successful"
systemctl enable tender-stack.service >/dev/null
trap - ERR

echo "Deployment successful: $target"

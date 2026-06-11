#!/usr/bin/env bash
set -Eeuo pipefail

repo_url="${TENDER_REPO_URL:-https://github.com/CuteMishka/tender.git}"
repo_dir="${TENDER_REPO_DIR:-/opt/tender/repo}"
env_file="${TENDER_ENV_FILE:-/etc/tender/tender.env}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git docker-compose-plugin

if ! command -v nvidia-ctk >/dev/null 2>&1; then
  arch="$(dpkg --print-architecture)"
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  cat >/etc/apt/sources.list.d/nvidia-container-toolkit.list <<EOF
deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://nvidia.github.io/libnvidia-container/stable/deb/${arch} /
#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://nvidia.github.io/libnvidia-container/experimental/deb/${arch} /
EOF
  apt-get update
  apt-get install -y nvidia-container-toolkit
fi

nvidia-ctk runtime configure --runtime=docker
systemctl restart docker
systemctl enable docker >/dev/null

install -d -m 0755 /opt/tender
install -d -m 0700 "$(dirname "$env_file")" /opt/tender/state

if [[ ! -d "$repo_dir/.git" ]]; then
  git clone "$repo_url" "$repo_dir"
else
  git -C "$repo_dir" fetch --prune origin
fi

for volume in \
  cloud-user_tender_postgres_data \
  cloud-user_rag_postgres_data \
  cloud-user_parser_downloads \
  cloud-user_ollama_data; do
  docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
done

if [[ ! -f "$env_file" ]]; then
  install -m 0600 "$repo_dir/.env.production.example" "$env_file"
  echo "Created $env_file. Fill in passwords and API keys, then run tender-deploy." >&2
fi

install -m 0755 "$repo_dir/scripts/deploy-vm.sh" /usr/local/sbin/tender-deploy
install -m 0755 "$repo_dir/scripts/rollback-vm.sh" /usr/local/sbin/tender-rollback
install -m 0755 "$repo_dir/scripts/healthcheck-vm.sh" /usr/local/sbin/tender-health

docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
echo "VM bootstrap completed."

#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [ "$EUID" -ne 0 ]; then
  echo "Run this script as root (sudo ops/harden_host.sh)" >&2
  exit 1
fi
if [ "${CONFIRM_KEYS_VERIFIED:-}" != "yes" ]; then
  echo "Refusing to disable SSH passwords until all private keys have been tested." >&2
  echo "Re-run with CONFIRM_KEYS_VERIFIED=yes after separate Codex, mansu and GitHub Actions key logins." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTHORIZED_KEYS=/home/cloud-user/.ssh/authorized_keys
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/var/backups/tender/host-hardening-$STAMP"

required_sources=(
  ops/ssh/10-tender-hardening.conf
  ops/fail2ban/tender.local
  ops/sysctl/99-tender-hardening.conf
  ops/firewall/tender-docker-firewall.sh
  ops/systemd/tender-docker-firewall.service
  ops/apt/20auto-upgrades
  ops/apt/52tender-unattended-upgrades
)
for source in "${required_sources[@]}"; do
  if [ ! -f "$ROOT_DIR/$source" ]; then
    echo "Missing source file: $ROOT_DIR/$source" >&2
    exit 1
  fi
done

if ! id cloud-user >/dev/null 2>&1; then
  echo "cloud-user does not exist" >&2
  exit 1
fi
if [ ! -f "$AUTHORIZED_KEYS" ]; then
  echo "$AUTHORIZED_KEYS is missing" >&2
  exit 1
fi

mapfile -t key_fingerprints < <(
  awk 'NF && $1 !~ /^#/' "$AUTHORIZED_KEYS" | while IFS= read -r key; do
    printf '%s\n' "$key" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}'
  done
)
if [ "${#key_fingerprints[@]}" -lt 2 ]; then
  echo "At least two valid authorized SSH keys are required before hardening" >&2
  exit 1
fi

required_fingerprints=(
  'SHA256:RJl4TJxsxqYtmd7BUO3+LGBdXCICGaRjlsPJxZObDPI'
  'SHA256:yaiUXeBNt2LBCqFaOiotM5TXHP1K9A9tuHkLBY/lC9o'
  'SHA256:+T1Sy+o2Ovkf0jIX0mdTY2eANBlQ2LpE9aWKPGZ/23E'
)
for required in "${required_fingerprints[@]}"; do
  found=false
  for actual in "${key_fingerprints[@]}"; do
    if [ "$actual" = "$required" ]; then
      found=true
      break
    fi
  done
  if [ "$found" != true ]; then
    echo "Required SSH key is missing: $required" >&2
    exit 1
  fi
done

if ! systemctl is-active --quiet ssh; then
  echo "OpenSSH is not active" >&2
  exit 1
fi
if ! systemctl is-active --quiet docker; then
  echo "Docker is not active" >&2
  exit 1
fi
sshd -t

install -d -m 0700 -o root -g root "$BACKUP_DIR/files"
ufw_was_active=false
if command -v ufw >/dev/null 2>&1 && ufw status | head -n 1 | grep -q 'Status: active'; then
  ufw_was_active=true
fi
fail2ban_was_enabled=false
fail2ban_was_active=false
systemctl is-enabled --quiet fail2ban 2>/dev/null && fail2ban_was_enabled=true
systemctl is-active --quiet fail2ban 2>/dev/null && fail2ban_was_active=true
docker_firewall_was_enabled=false
docker_firewall_was_active=false
systemctl is-enabled --quiet tender-docker-firewall.service 2>/dev/null && docker_firewall_was_enabled=true
systemctl is-active --quiet tender-docker-firewall.service 2>/dev/null && docker_firewall_was_active=true

targets=(
  /etc/ssh/sshd_config.d/10-tender-hardening.conf
  /etc/fail2ban/jail.d/tender.local
  /etc/sysctl.d/99-tender-hardening.conf
  /etc/apt/apt.conf.d/20auto-upgrades
  /etc/apt/apt.conf.d/52tender-unattended-upgrades
  /usr/local/sbin/tender-docker-firewall
  /etc/systemd/system/tender-docker-firewall.service
)
for target in "${targets[@]}"; do
  relative="${target#/}"
  if [ -e "$target" ] || [ -L "$target" ]; then
    install -d "$BACKUP_DIR/files/$(dirname "$relative")"
    cp -a "$target" "$BACKUP_DIR/files/$relative"
    touch "$BACKUP_DIR/files/$relative.was-present"
  fi
done
if [ -d /etc/ufw ]; then
  cp -a /etc/ufw "$BACKUP_DIR/ufw"
fi
cp -a "$AUTHORIZED_KEYS" "$BACKUP_DIR/authorized_keys.audit-copy"

restore_target() {
  local target="$1"
  local relative="${target#/}"
  if [ -f "$BACKUP_DIR/files/$relative.was-present" ]; then
    cp -a "$BACKUP_DIR/files/$relative" "$target"
  else
    rm -f -- "$target"
  fi
}

rollback() {
  local status=$?
  trap - ERR
  set +e
  echo "Host hardening failed; restoring configuration from $BACKUP_DIR" >&2
  for target in "${targets[@]}"; do restore_target "$target"; done
  if [ -d "$BACKUP_DIR/ufw" ]; then
    cp -a "$BACKUP_DIR/ufw/." /etc/ufw/
  fi
  systemctl daemon-reload
  if [ "$docker_firewall_was_active" = true ]; then
    systemctl restart tender-docker-firewall.service
  else
    systemctl stop tender-docker-firewall.service 2>/dev/null || true
  fi
  if [ "$docker_firewall_was_enabled" = true ]; then
    systemctl enable tender-docker-firewall.service >/dev/null 2>&1 || true
  else
    systemctl disable tender-docker-firewall.service >/dev/null 2>&1 || true
  fi
  sshd -t && systemctl reload ssh
  sysctl --system >/dev/null
  if [ "$ufw_was_active" = true ]; then ufw --force enable; else ufw --force disable; fi
  if [ "$fail2ban_was_active" = true ]; then systemctl restart fail2ban; else systemctl stop fail2ban; fi
  if [ "$fail2ban_was_enabled" = true ]; then systemctl enable fail2ban; else systemctl disable fail2ban; fi
  exit "$status"
}
trap rollback ERR

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ufw fail2ban unattended-upgrades

install -D -m 0644 -o root -g root "$ROOT_DIR/ops/apt/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
install -D -m 0644 -o root -g root "$ROOT_DIR/ops/apt/52tender-unattended-upgrades" /etc/apt/apt.conf.d/52tender-unattended-upgrades
systemctl enable --now unattended-upgrades.service

install -D -m 0644 -o root -g root "$ROOT_DIR/ops/sysctl/99-tender-hardening.conf" /etc/sysctl.d/99-tender-hardening.conf
sysctl --system >/dev/null

ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment 'SSH key-only'
ufw allow 80/tcp comment 'HTTP redirect and ACME'
ufw allow 443/tcp comment 'HTTPS portal'

for port in 5433 5434 8082 8083 11434 18080; do
  while true; do
    number="$(ufw status numbered | awk -v port="$port" '
      $0 ~ "(^|[[:space:]])" port "/tcp" && $0 ~ /ALLOW/ {
        if (match($0, /\[[[:space:]]*[0-9]+\]/)) {
          value=substr($0, RSTART+1, RLENGTH-2); gsub(/[[:space:]]/, "", value); print value; exit
        }
      }')"
    [ -n "$number" ] || break
    ufw --force delete "$number"
  done
done
ufw --force enable

install -D -m 0750 -o root -g root "$ROOT_DIR/ops/firewall/tender-docker-firewall.sh" /usr/local/sbin/tender-docker-firewall
install -D -m 0644 -o root -g root "$ROOT_DIR/ops/systemd/tender-docker-firewall.service" /etc/systemd/system/tender-docker-firewall.service
systemctl daemon-reload
systemctl enable --now tender-docker-firewall.service

install -D -m 0644 -o root -g root "$ROOT_DIR/ops/fail2ban/tender.local" /etc/fail2ban/jail.d/tender.local
fail2ban-client -t
systemctl enable --now fail2ban.service
systemctl restart fail2ban.service

# SSH is deliberately last. authorized_keys is never written by this script.
install -D -m 0644 -o root -g root "$ROOT_DIR/ops/ssh/10-tender-hardening.conf" /etc/ssh/sshd_config.d/10-tender-hardening.conf
sshd -t
effective_sshd="$(sshd -T)"
grep -qx 'passwordauthentication no' <<<"$effective_sshd"
grep -qx 'kbdinteractiveauthentication no' <<<"$effective_sshd"
grep -qx 'permitrootlogin no' <<<"$effective_sshd"
grep -qx 'allowusers cloud-user' <<<"$effective_sshd"
grep -qx 'allowtcpforwarding local' <<<"$effective_sshd"
grep -qx 'allowagentforwarding no' <<<"$effective_sshd"
grep -qx 'x11forwarding no' <<<"$effective_sshd"
systemctl reload ssh.service

# Confirm that the key file did not change byte-for-byte during the run.
cmp -s "$AUTHORIZED_KEYS" "$BACKUP_DIR/authorized_keys.audit-copy"

trap - ERR
echo "Host hardening completed. Backup: $BACKUP_DIR"
echo "Immediately verify new SSH sessions with Codex, mansu and GitHub Actions keys before closing this session."
ufw status verbose
fail2ban-client status sshd
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|allowtcpforwarding|allowagentforwarding|x11forwarding) '

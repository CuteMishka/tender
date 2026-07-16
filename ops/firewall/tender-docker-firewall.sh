#!/usr/bin/env bash
set -euo pipefail

# Docker may place published ports ahead of host firewall policy. The Compose
# file already binds internal services to loopback; this chain is a second,
# independent guard against a future accidental 0.0.0.0 publication.
action="${1:-apply}"
chain=DOCKER-USER
interface="${PUBLIC_INTERFACE:-$(ip -o route show to default | awk '{print $5; exit}')}"

if [ -z "$interface" ]; then
  echo "Unable to determine the public interface" >&2
  exit 1
fi

iptables -nL "$chain" >/dev/null

rule=(-i "$interface" -p tcp -m multiport --dports 5433,5434,8082,8083,11434,18080 -j DROP)
case "$action" in
  apply)
    if ! iptables -C "$chain" "${rule[@]}" 2>/dev/null; then
      iptables -I "$chain" 1 "${rule[@]}"
    fi
    ;;
  remove)
    while iptables -C "$chain" "${rule[@]}" 2>/dev/null; do
      iptables -D "$chain" "${rule[@]}"
    done
    ;;
  *)
    echo "Usage: $0 [apply|remove]" >&2
    exit 2
    ;;
esac

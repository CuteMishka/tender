# Production hardening: qolab.kz / 85.116.182.35

This runbook is intentionally staged. Do not combine the SSH, firewall and
application cutovers into one unobserved command. Keep the provider console
open and keep one existing SSH session connected until every key-only login
has been re-tested.

## Audited state on 2026-07-16

- Ubuntu 24.04.2 LTS; Nginx 1.24; Docker 29.1.3.
- Public from an independent network: `22`, `80`, `443`, `8082`, `8083`.
- Listening on all VM interfaces: `22`, `80`, `443`, `8082`, `8083`, `18080`,
  `5433`, `5434`. The provider happened to filter the last three, but the VM
  did not enforce that boundary.
- UFW inactive; fail2ban absent; SSH password login enabled by
  `/etc/ssh/sshd_config.d/90-ssh-enable.conf`.
- Nginx served HTTP without redirect, allowed TLS 1.0/1.1, exposed its version,
  had no edge rate limits/security headers and used 200 MiB/300 second global
  limits.
- The running Compose project mixed files from `/home/cloud-user` and
  `/home/cloud-user/tender1`. The canonical files are now
  `/home/cloud-user/tender1/docker-compose*.yml`; persistent volume names are
  pinned so the project-label cleanup does not replace data volumes.
- `/home/cloud-user/tender1/.env` was mode `0664`; historical `.env` backups
  were also group/world-readable. There was no scheduled database backup.
- Git history contains the formerly tracked root `.env`. At minimum, historic
  revisions expose non-empty PostgreSQL passwords, a Gemini API key and a
  TenderPlus token. Rotation is required even if the repository is private.

Expected authorized user keys (the hardening script verifies all three and
does not write `authorized_keys`):

| Owner | Fingerprint |
|---|---|
| mansu | `SHA256:RJl4TJxsxqYtmd7BUO3+LGBdXCICGaRjlsPJxZObDPI` |
| Codex | `SHA256:yaiUXeBNt2LBCqFaOiotM5TXHP1K9A9tuHkLBY/lC9o` |
| GitHub Actions | `SHA256:+T1Sy+o2Ovkf0jIX0mdTY2eANBlQ2LpE9aWKPGZ/23E` |

Current ED25519 VM host-key fingerprint:
`SHA256:ZNlGRY6eS/WKGG5aGPW2gZPgfD1WodVmsOx+0wgWwyQ`.
Store the corresponding known-host line in the GitHub Actions secret
`VPS_SSH_KNOWN_HOSTS`; never regenerate it with `ssh-keyscan` inside CI.

## What the repository enforces

- PostgreSQL, pgvector and Ollama have no published host ports.
- Backend `8082`, RAG `8083` and frontend `18080` bind only to `127.0.0.1`.
- Host networking was removed. Services use private `app`, `data` and `ai`
  networks and service DNS names.
- Public RAG paths `/rag/*` and `/v1/*` return `404`. Browser RAG calls travel
  through authenticated/CSRF-protected Go routes under `/api/v1/rag/*`; only
  Go/parser-to-FastAPI traffic carries `X-Internal-Service-Token`.
- Nginx explicitly removes `X-Internal-Service-Token` and replaces client XFF
  at the public edge.
- Application containers use a read-only root filesystem, bounded tmpfs,
  `no-new-privileges`, dropped capabilities where safe, PID limits and rotated
  JSON logs. Backend and frontend images run as non-root users.
- Ollama is pinned through `OLLAMA_IMAGE_TAG` (default `0.30.0`) instead of the
  mutable `latest` tag.
- Nginx provides HTTPS-only canonical hosting, TLS 1.2/1.3 through Certbot's
  maintained policy, security headers, bounded bodies/timeouts, connection and
  request rate limits. Only the document-index route has a 66 MiB edge limit;
  Go still enforces 64 MiB.
- The deploy workflow uses a pinned SSH host key, never places the GHCR token
  in the remote command line, deploys immutable commit tags, backs up both
  databases, tests protected/public boundaries and logs out of GHCR.
- The parser schedule enters over the SSH control plane and reads the service
  token only on the VM. The bearer is never accepted through public Nginx.

## Phase 0: provider and access prerequisites

1. Create a provider snapshot and confirm provider-console/rescue access.
2. In the provider firewall/security group, allow inbound TCP `22`, `80`,
   `443`; deny every other inbound port. Keep outbound enabled for registry,
   tender platforms, AI providers, apt and certificate renewal.
3. Keep TCP `22` open globally while GitHub-hosted runners are used; their
   source ranges change. Safety comes from key-only SSH, pinned host keys,
   fail2ban and UFW `limit`. A future Tailscale/WireGuard or self-hosted runner
   can restrict the source network further.
4. From independent clients, prove all three private keys work without a
   password. Do not continue if any command fails:

   ```bash
   ssh -o BatchMode=yes -o PasswordAuthentication=no -i ~/.ssh/codex_tender_vm_ed25519 cloud-user@85.116.182.35 true
   ssh -o BatchMode=yes -o PasswordAuthentication=no -i /path/to/mansu_key cloud-user@85.116.182.35 true
   ssh -o BatchMode=yes -o PasswordAuthentication=no -i ~/.ssh/tender_github_actions cloud-user@85.116.182.35 true
   ```

5. Configure these GitHub repository secrets/variables before dispatching:

   - `VPS_HOST=85.116.182.35`
   - `VPS_USER=cloud-user`
   - `VPS_SSH_KEY` (GitHub Actions private deployment key)
   - `VPS_SSH_KNOWN_HOSTS` (pinned current host public-key record)
   - optional variables `PUBLIC_BACKEND_URL=https://qolab.kz` and
     `PUBLIC_RAG_URL=https://qolab.kz/api/v1/rag`

## Phase 1: rotate secrets before deployment

Generate values without printing them into CI logs or chat:

```bash
umask 077
openssl rand -hex 32  # POSTGRES_PASSWORD (URL-safe)
openssl rand -hex 32  # RAG_POSTGRES_PASSWORD (URL-safe)
openssl rand -hex 32  # BACKEND_INTERNAL_SERVICE_TOKEN
openssl rand -hex 32  # RAG_INTERNAL_SERVICE_TOKEN (must be different)
```

For existing PostgreSQL volumes, changing `.env` alone does **not** change the
database role. While the old containers are healthy, back up first, then alter
each role using `psql` and update `/home/cloud-user/tender1/.env` in the same
maintenance window. Use psql variables/stdin so a password is not placed in
shell history or a process argument. Verify a fresh connection before ending
the old session.

Rotate locally/on the VM:

- `POSTGRES_PASSWORD`, `RAG_POSTGRES_PASSWORD` (both were in Git history);
- `BACKEND_INTERNAL_SERVICE_TOKEN` and `RAG_INTERNAL_SERVICE_TOKEN` (new,
  distinct values with at least 32 random characters each); remove the legacy
  shared `INTERNAL_SERVICE_TOKEN` entry;
- application user/admin passwords and revoke all pre-cutover sessions;
- remove obsolete `PARSER_DATABASE_URL`, direct-RAG and parser AI secrets from
  GitHub after the new SSH enqueue workflow succeeds.

Rotate in external provider consoles, then update only the root-owned VM env:

- TenderPlus token;
- Gemini API key;
- Groq, Goszakup/OWS and Telegram tokens if they were ever present in an old
  env file or backup;
- object-storage/restic credentials used for off-site backups.

The SSH keys were not found in Git history and do not need rotation solely for
this incident. Add a new key before removing an old one; never edit all access
keys in one step.

After rotation:

```bash
sudo chown cloud-user:cloud-user /home/cloud-user/tender1/.env
sudo chmod 0600 /home/cloud-user/tender1/.env
sudo find /home/cloud-user -maxdepth 3 -type f -name '.env*' -printf '%m %u:%g %p\n'
```

Move required historical copies into an encrypted offline archive or delete
them. Plaintext `.env.backup*` files must not remain mode `0664`.

Because `.env` exists in published Git history, rotate first and then remove
the path from all refs with `git filter-repo` in a coordinated maintenance
window. Force-pushing history without rotating is not remediation. Every clone
and fork must be treated as retaining the old values.

## Phase 2: deploy application/network/Nginx hardening

Dispatch `Deploy VPS via GHCR` for the reviewed commit. The deployment script:

1. validates required secrets and Compose;
2. pulls the immutable commit tag;
3. creates verified logical backups in `/var/backups/tender`;
4. stages Nginx with automatic rollback on syntax, application-health or
   public-acceptance failure;
5. removes only seven legacy containers by exact Compose labels;
6. reuses the pinned existing named volumes;
7. starts and health-checks private services;
8. requires unauthenticated API `401` and public RAG `404`;
9. reloads Nginx only after upstream health passes;
10. installs and exercises the daily database-backup timer.

Do not run `docker compose down -v`, `docker volume prune`, or change the four
existing `cloud-user_*` volume names.

## Phase 3: host hardening (explicit, not part of deploy)

Keep two SSH sessions open and the provider console ready. From the canonical
checkout on the VM:

```bash
cd /home/cloud-user/tender1
sudo CONFIRM_KEYS_VERIFIED=yes ./ops/harden_host.sh
```

The idempotent script requires all three audited keys and at least two valid
keys, backs up affected configuration under
`/var/backups/tender/host-hardening-*`, and has an error trap that restores SSH,
UFW, fail2ban, sysctl and the Docker firewall service. It then:

- enables UFW default-deny inbound with only `22` (rate-limited), `80`, `443`;
- adds a `DOCKER-USER` drop for `5433`, `5434`, `8082`, `8083`, `11434`,
  `18080` in case a future Compose edit accidentally publishes them;
- enables aggressive sshd fail2ban plus recidive bans;
- enables unattended security updates without automatic reboot;
- applies conservative host sysctls;
- disables SSH root/password/keyboard-interactive login, agent/X11/remote
  forwarding, but retains local TCP forwarding for Codex maintenance;
- validates effective `sshd -T` before reloading SSH;
- never writes or deletes `authorized_keys`.

Immediately open fresh key-only sessions for mansu and Codex. Manually dispatch
the parser workflow (which exercises the GitHub Actions key). Do not close the
original session until all three pass.

## Backups and restore testing

`tender-backup.timer` creates daily custom-format logical dumps, verifies each
with `pg_restore --list`, writes SHA-256 manifests and retains 14 days locally.
Configure encrypted off-site restic storage:

```bash
sudo install -d -m 0700 -o root -g root /etc/tender
sudo install -m 0600 -o root -g root ops/backup/backup.env.example /etc/tender/backup.env
sudo sh -c 'umask 077; openssl rand -base64 48 > /etc/tender/restic-password'
# Edit placeholders without echoing secrets, then initialize once:
sudo bash -c 'set -a; . /etc/tender/backup.env; set +a; restic init'
sudo systemctl start tender-backup.service
sudo journalctl -u tender-backup.service -n 100 --no-pager
```

Use an object-store account restricted to the backup bucket. Prefer object
versioning/retention so a compromised VM cannot immediately destroy every
copy. Test a restore quarterly into temporary databases, compare row counts,
then drop only the temporary databases.

## Acceptance tests

From outside the provider network:

```bash
nmap -Pn -p 22,80,443,5433,5434,8082,8083,11434,18080 85.116.182.35
curl -sS -o /dev/null -D - http://qolab.kz/
curl -sS -o /dev/null -D - https://qolab.kz/
curl -sS -o /dev/null -w '%{http_code}\n' https://qolab.kz/api/v1/tenders
curl -sS -o /dev/null -w '%{http_code}\n' https://qolab.kz/rag/health
```

Expected: only `22/80/443` open; HTTP `308`; HTTPS includes HSTS, CSP,
`nosniff`, frame and permissions headers; unauthenticated API `401`; RAG `404`.

On the VM:

```bash
sudo ss -lntp | grep -E ':(22|80|443|5433|5434|8082|8083|11434|18080)\b'
sudo ufw status verbose
sudo fail2ban-client status sshd
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|allowtcpforwarding|allowagentforwarding|x11forwarding) '
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo systemctl list-timers tender-backup.timer --all
sudo systemctl start tender-backup.service
sudo journalctl -u tender-backup.service -n 100 --no-pager
```

Application security tests:

- login returns `Secure; HttpOnly; SameSite=Strict` for `tender_session` and a
  Secure SameSite CSRF cookie;
- protected reads without a session return `401`;
- unsafe browser requests without or with a wrong `X-CSRF-Token` return `403`;
- a specialist cannot call admin user/settings endpoints (`403`);
- an admin can perform the same operation;
- either real internal token sent through public Nginx still returns `401` because
  the edge strips the header;
- the backend token over loopback/Docker can access only the narrow automation
  routes and cannot access user administration or RAG mutation proxies;
- the RAG token is accepted by FastAPI but rejected as backend service
  authentication, and the two configured values are not equal;
- direct `8082/8083` connections from outside fail.

## Rollback

Application/image rollback: re-run the successful GitHub Actions workflow run
that belongs to the previous commit, or dispatch from a branch/tag pointing to
that commit. Keep `image_tag` equal to that checked-out commit SHA; never build
newer source under an older SHA tag. This uses the same pinned SSH host key and
short-lived GHCR authentication as a normal deployment. If an emergency manual
rollback is unavoidable, authenticate Docker to GHCR first, then run:

```bash
cd /home/cloud-user/tender1
sudo env GHCR_IMAGE_PREFIX=ghcr.io/cutemishka/tender IMAGE_TAG=<previous-commit-sha> \
  bash scripts/deploy_ghcr_vm.sh
```

Use the pre-deploy `.dump` files only if the application rollback also requires
a schema/data rollback. Never restore over the sole production database first;
restore into a temporary database and validate.

Nginx rollback files are stored at
`/var/backups/tender/nginx-<deployment-timestamp>`. If the original SSH session
is lost after host hardening, use the provider console:

```bash
sudo rm -f /etc/ssh/sshd_config.d/10-tender-hardening.conf
sudo sshd -t
sudo systemctl reload ssh
```

Then restore the audited hardening backup rather than enabling password SSH.
Provider-firewall rollback must be done in the provider console; never expose
database/application ports as a troubleshooting shortcut. Use key-only SSH
local forwarding or `docker exec` instead.

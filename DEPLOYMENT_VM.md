# Deployment on the Freedom Cloud VM

This is the source of truth for production deployment without a domain or TLS.

## Production layout

- VM: `cloud-user@85.116.182.35`
- Repository: `/opt/tender/repo`
- Secrets: `/etc/tender/tender.env` (`root:root`, mode `0600`)
- Compose project: `tender`
- Public UI and backend: `http://85.116.182.35/` and `http://85.116.182.35:8082/`
- Public RAG API: `http://85.116.182.35:8083/`
- Deployment command: `sudo tender-deploy <branch|tag|sha>`
- Rollback command: `sudo tender-rollback [sha]`
- Health command: `sudo tender-health`

The backend, parser, frontend, RAG, Ollama and both PostgreSQL databases run only
through `docker-compose.prod.yml`. The old host backend and Python proxy must
remain disabled.

## Access from a future Codex session

The dedicated key is stored on this workstation:

```powershell
ssh -i "$HOME\.ssh\codex_tender_vm_ed25519" cloud-user@85.116.182.35
```

Do not put the SSH password in scripts, Git or `.env`. The password and API keys
previously committed or sent in chat must be rotated separately.

## Normal deployment

1. Make changes on a branch and run tests.
2. Push the branch to GitHub.
3. Deploy the exact branch or commit:

```bash
sudo tender-deploy codex/my-branch
# or
sudo tender-deploy 0123456789abcdef
```

The deploy script fetches Git, validates Compose, builds images, starts the
stack, waits for container health checks and tests all public endpoints. If any
step fails, it automatically checks out and starts the previous revision.

For `main`:

```bash
sudo tender-deploy main
```

## Verification and diagnostics

```bash
sudo tender-health
sudo docker compose -p tender \
  --env-file /etc/tender/tender.env \
  -f /opt/tender/repo/docker-compose.prod.yml ps
sudo docker compose -p tender \
  --env-file /etc/tender/tender.env \
  -f /opt/tender/repo/docker-compose.prod.yml logs --tail=200 backend parser gateway
```

Check parser timing:

```bash
sudo grep '^PARSER_POLL_INTERVAL_SECONDS=' /etc/tender/tender.env
```

`1800` means one cycle every 30 minutes. The continuous VM parser is the only
scheduled parser. GitHub Actions no longer starts it on a cron schedule.

## Rollback

Return to the last successful revision:

```bash
sudo tender-rollback
```

Return to a specific commit:

```bash
sudo tender-rollback <commit-sha>
```

Database volumes are external and are never deleted by deploy or rollback:

- `cloud-user_tender_postgres_data`
- `cloud-user_rag_postgres_data`
- `cloud-user_parser_downloads`
- `cloud-user_ollama_data`

Never run `docker compose down -v` in production.

## Secrets and configuration

Edit production settings only here:

```bash
sudoedit /etc/tender/tender.env
sudo tender-deploy "$(git -C /opt/tender/repo rev-parse HEAD)"
```

The template is `.env.production.example`. The real `.env` is ignored by Git.
Required values are:

- `POSTGRES_PASSWORD`
- `RAG_POSTGRES_PASSWORD`
- `ADMIN_PASSWORD`
- `TENDERPLUS_TOKEN`
- at least one AI key when Gemini/Groq is selected

## GPU and local model

Docker uses NVIDIA Container Toolkit. Verify it with:

```bash
sudo docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
sudo docker exec tender-llm-1 ollama ps
```

The current L40S has enough VRAM for `qwen2.5:14b`, which is the conservative
production upgrade from `qwen2.5:3b`:

```bash
sudo docker exec tender-llm-1 ollama pull qwen2.5:14b
```

Keep at least 10 GB of free disk space before pulling another model.

## First-time bootstrap on another Ubuntu VM

```bash
sudo bash scripts/bootstrap-vm.sh
sudoedit /etc/tender/tender.env
sudo tender-deploy main
```

The bootstrap installs Compose v2 and NVIDIA Container Toolkit, creates the
external volumes, clones the repository and verifies GPU access.

## Backups

Before schema or storage changes, create PostgreSQL dumps and copy them off the
VM. The pre-migration backup on the current VM is:

```text
/home/cloud-user/backups/pre-unified-deploy-20260611-153539
```

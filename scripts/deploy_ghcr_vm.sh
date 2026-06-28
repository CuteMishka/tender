#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/cloud-user/tender1}"
GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:?GHCR_IMAGE_PREFIX is required}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo ".env not found in $APP_DIR"
  exit 1
fi

if [ ! -f docker-compose.prod.yml ] || [ ! -f docker-compose.ghcr.yml ]; then
  echo "docker-compose.prod.yml or docker-compose.ghcr.yml is missing in $APP_DIR"
  exit 1
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | sudo docker login ghcr.io -u "${GHCR_USERNAME:-github-actions}" --password-stdin >/dev/null
fi

if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "Docker Compose is not installed"
  exit 1
fi

compose=(
  sudo env
  "GHCR_IMAGE_PREFIX=$GHCR_IMAGE_PREFIX"
  "IMAGE_TAG=$IMAGE_TAG"
  "${compose_cmd[@]}"
  -f docker-compose.prod.yml
  -f docker-compose.ghcr.yml
  --env-file .env
)

echo "Pulling application images from $GHCR_IMAGE_PREFIX with tag $IMAGE_TAG"
"${compose[@]}" pull backend parser rag-api frontend

echo "Removing stale service containers without deleting volumes..."
"${compose[@]}" rm -sf postgres rag-db llm backend rag-api frontend parser || true

echo "Ensuring base services are running..."
"${compose[@]}" up -d --no-build --remove-orphans postgres rag-db llm

echo "Starting application services from pulled images..."
"${compose[@]}" up -d --no-build --remove-orphans backend rag-api frontend parser

echo "Waiting for backend health..."
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8082/health >/dev/null; then
    break
  fi
  sleep 3
done
curl -fsS http://127.0.0.1:8082/health
echo

echo "Waiting for RAG health..."
for _ in $(seq 1 40); do
  rag_health="$(curl -fsS http://127.0.0.1:8083/health 2>/dev/null || true)"
  if echo "$rag_health" | grep -q '"database":true'; then
    break
  fi
  sleep 3
done
rag_health="$(curl -fsS http://127.0.0.1:8083/health)"
echo "$rag_health"
echo "$rag_health" | grep -q '"database":true'
echo

echo "Checking first tender response..."
curl -fsS "http://127.0.0.1:8082/api/v1/tenders?limit=1" >/dev/null

echo "Containers:"
"${compose[@]}" ps

echo "GHCR deploy completed: $GHCR_IMAGE_PREFIX with tag $IMAGE_TAG"

#!/usr/bin/env bash
set -euo pipefail

cd /home/cloud-user

if [ ! -f .env ]; then
  echo ".env not found in /home/cloud-user"
  exit 1
fi

if ! grep -q '^TENDERPLUS_TOKEN=' .env || grep -q '^TENDERPLUS_TOKEN=$' .env; then
  echo "TENDERPLUS_TOKEN is missing in .env"
  exit 1
fi

echo "Stopping old project containers..."
sudo docker rm -f direct_parser cloud-user_parser_1 tender-parser parser 2>/dev/null || true
sudo docker ps -a --format '{{.Names}}' | grep -Ei 'parser' | xargs -r sudo docker rm -f || true

echo "Removing old parser source directory..."
sudo rm -rf /home/cloud-user/parser

echo "Building fresh images..."
sudo docker build --no-cache -t cloud-user_backend:latest ./tenderai
sudo docker build --no-cache -t cloud-user_rag-api:latest ./tender-rag
sudo docker build --no-cache -t cloud-user_frontend:latest ./tenderflow-admin

echo "Recreating only the required services..."
sudo docker-compose -f docker-compose.prod.yml --env-file .env down --remove-orphans
sudo docker-compose -f docker-compose.prod.yml --env-file .env up -d postgres rag-db llm

echo "Waiting for databases and local LLM..."
sleep 15
sudo docker-compose -f docker-compose.prod.yml --env-file .env up -d backend rag-api frontend

echo "Ensuring local LLM model exists..."
sudo docker exec llm ollama pull qwen2.5:3b || true

echo "Waiting for services..."
sleep 20

echo "Containers:"
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo "Backend health:"
curl -fsS http://localhost:8082/health
echo

echo "RAG health:"
curl -fsS http://localhost:8083/health
echo

echo "First TenderPlus lot:"
curl -fsS 'http://localhost:8082/api/v1/tenders?limit=1'
echo

echo "Parser containers left:"
sudo docker ps -a --format '{{.Names}}' | grep -i parser || true

echo "Done. Open: http://85.116.182.35:8080"

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/cloud-user/tender1}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

read -r -p "Developer database username: " developer_db_user
if [[ ! "$developer_db_user" =~ ^[a-z_][a-z0-9_]{0,30}$ ]]; then
  echo "Username must match ^[a-z_][a-z0-9_]{0,30}$" >&2
  exit 1
fi

read -r -s -p "New database password: " developer_db_password
echo
read -r -s -p "Repeat database password: " developer_db_password_repeat
echo

if [ "$developer_db_password" != "$developer_db_password_repeat" ]; then
  echo "Passwords do not match" >&2
  exit 1
fi
if [ "${#developer_db_password}" -lt 20 ]; then
  echo "Password must contain at least 20 characters" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose=(
  sudo docker compose
  --env-file "$ENV_FILE"
  -f "$APP_DIR/docker-compose.prod.yml"
  -f "$APP_DIR/docker-compose.ghcr.yml"
)

sql_password="${developer_db_password//\'/\'\'}"

provision_role() {
  local service="$1"
  local admin_user="$2"
  local database="$3"

  {
    printf "DO \$\$ BEGIN\n"
    printf "  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN\n" "$developer_db_user"
    printf "    CREATE ROLE %s LOGIN PASSWORD '%s';\n" "$developer_db_user" "$sql_password"
    printf "  ELSE\n"
    printf "    ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$developer_db_user" "$sql_password"
    printf "  END IF;\n"
    printf "END \$\$;\n"
    printf "ALTER ROLE %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n" "$developer_db_user"
    printf "GRANT CONNECT ON DATABASE %s TO %s;\n" "$database" "$developer_db_user"
    printf "GRANT USAGE ON SCHEMA public TO %s;\n" "$developer_db_user"
    printf "GRANT SELECT ON ALL TABLES IN SCHEMA public TO %s;\n" "$developer_db_user"
    printf "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %s;\n" "$developer_db_user"
  } | "${compose[@]}" exec -T "$service" psql -v ON_ERROR_STOP=1 -U "$admin_user" -d "$database"
}

provision_role postgres "${POSTGRES_USER:-tender}" "${POSTGRES_DB:-tender}"
provision_role rag-db "${RAG_POSTGRES_USER:-rag}" "${RAG_POSTGRES_DB:-rag}"

unset developer_db_password developer_db_password_repeat sql_password

echo "Read-only role '$developer_db_user' is ready in both databases."
echo "Use SSH tunnels to 127.0.0.1:${POSTGRES_SSH_PORT:-15432} and 127.0.0.1:${RAG_POSTGRES_SSH_PORT:-15433}."

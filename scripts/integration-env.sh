#!/usr/bin/env bash
# Run the integration tests locally against Docker (Postgres + PostGIS + PostgREST).
#   bash scripts/integration-env.sh        # starts containers, loads schema, runs tests
#   bash scripts/integration-env.sh down   # removes the containers
set -euo pipefail
cd "$(dirname "$0")/.."
SECRET="serwish-local-test-secret-at-least-32-chars-long"
NET=serwish-test

if [[ "${1:-}" == "down" ]]; then
  docker rm -f serwish-pg serwish-rest >/dev/null 2>&1 || true
  docker network rm $NET >/dev/null 2>&1 || true
  exit 0
fi

docker network create $NET >/dev/null 2>&1 || true
docker run -d --rm --name serwish-pg --network $NET -p 54329:5432 -e POSTGRES_PASSWORD=postgres postgis/postgis:16-3.4 >/dev/null
until docker exec serwish-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
export DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres
bash scripts/db-check.sh
psql "$DATABASE_URL" -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'authenticator' noinherit; end if; end \$\$; grant anon, service_role to authenticator;"

docker run -d --rm --name serwish-rest --network $NET -p 54399:3000 \
  -e PGRST_DB_URI=postgres://authenticator:authenticator@serwish-pg:5432/postgres \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_EXTRA_SEARCH_PATH="public, extensions" \
  -e PGRST_JWT_SECRET=$SECRET postgrest/postgrest:v12.2.3 >/dev/null
sleep 2

export TEST_POSTGREST_URL=http://127.0.0.1:54399
export TEST_SERVICE_ROLE_JWT=$(node scripts/make-test-jwt.mjs service_role "$SECRET")
npx vitest run

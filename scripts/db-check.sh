#!/usr/bin/env bash
# Apply the v2 migrations + seed to an empty Postgres/PostGIS database and run
# the rule checks. Used by CI and locally:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:check
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to an empty PostGIS database}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
cd "$(dirname "$0")/.."

# Supabase-like roles so the lockdown statements and checks run (no-ops if present).
"${PSQL[@]}" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
SQL

for f in supabase/migrations/2026*.sql; do
  echo "-> $f"
  "${PSQL[@]}" -1 -f "$f"
done
echo "-> supabase/seed.sql"
"${PSQL[@]}" -1 -f supabase/seed.sql
echo "-> seed again (must be idempotent)"
"${PSQL[@]}" -1 -f supabase/seed.sql
for f in supabase/tests/*.sql; do
  echo "-> $f"
  "${PSQL[@]}" -f "$f"
done

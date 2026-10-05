-- =============================================================================
-- SerWish v2 - step 1 of 2: remove the legacy (v1) schema
-- =============================================================================
-- Owner decision (2026-10-01): the current database holds test data only, so
-- v2 starts from a clean schema instead of converting 001-003 in place.
--
-- Safety: this only runs when it detects the legacy schema (tables that do not
-- exist in v2: providers, service_categories, wallet_transactions,
-- booking_provider_responses). On a fresh project or an already-migrated v2
-- database it does nothing.
--
-- It drops every table, view, type and function in the public schema that is
-- NOT owned by an extension (PostGIS objects are kept).
-- =============================================================================

do $$
declare
  legacy boolean;
  r record;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name in ('providers', 'service_categories', 'wallet_transactions', 'booking_provider_responses')
  ) into legacy;

  if not legacy then
    raise notice 'SerWish v2 reset: no legacy schema found, nothing to drop.';
    return;
  end if;

  raise notice 'SerWish v2 reset: legacy schema found, dropping public objects.';

  -- Views
  for r in
    select c.oid::regclass as obj from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop view if exists %s cascade', r.obj);
  end loop;

  -- Tables
  for r in
    select c.oid::regclass as obj from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and c.relname not in ('spatial_ref_sys')
  loop
    execute format('drop table if exists %s cascade', r.obj);
  end loop;

  -- Functions
  for r in
    select p.oid::regprocedure as obj from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.obj);
  end loop;

  -- Types (enums and composites created by migrations)
  for r in
    select t.oid::regtype as obj from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'c', 'd')
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
      and not exists (select 1 from pg_class c where c.reltype = t.oid)
  loop
    execute format('drop type if exists %s cascade', r.obj);
  end loop;
end $$;

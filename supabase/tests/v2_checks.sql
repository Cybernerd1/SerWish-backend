-- =============================================================================
-- SerWish v2 database checks. Run after the migrations and seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/v2_checks.sql
-- Everything runs in one transaction and is rolled back. Any failed check
-- raises an exception, so a non-zero exit code means a broken rule.
-- =============================================================================
begin;
set search_path = public, extensions;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then
      raise exception 'Expected error like "%" but got "%" for: %', p_like, sqlerrm, p_sql;
    end if;
    return;
  end;
  raise exception 'Expected an error like "%" but the statement succeeded: %', p_like, p_sql;
end $$;

-- Fixtures: one customer and one booking in Sector 56 for home cleaning.
insert into users (id, name, phone) values ('t_customer', 'Test Customer', '9876500001');
insert into users (id, name, phone) values ('t_pending', 'Pending Partner', '9876500002');
insert into provider_profiles (user_id, kyc_status, kyc_id_doc_path, kyc_cert_doc_path)
values ('t_pending', 'pending', 'x/id.jpg', 'x/cert.jpg');

create temp table t_ids as
select gen_random_uuid() as booking_id;

insert into bookings (id, customer_id, service_id, address_text, location, base_price, total)
select t.booking_id, 't_customer', s.id, 'B-120, Sector 56', st_setsrid(st_makepoint(77.1036, 28.4231), 4326)::geography, 299, 299
from t_ids t, services s where s.slug = 'home-clean';

do $$
declare
  v_id uuid := (select booking_id from t_ids);
  v_n int;
  v_first text;
  v_offer uuid;
  v_offer2 uuid;
  v_b bookings;
begin
  -- 1. Insert wrote an audit event.
  select count(*) into v_n from booking_events where booking_id = v_id and to_status = 'searching';
  if v_n <> 1 then raise exception 'insert event missing'; end if;

  -- 2. Illegal transitions are rejected.
  perform pg_temp.expect_error(format('update bookings set status = %L where id = %L', 'completed', v_id), '%Illegal booking transition%');
  perform pg_temp.expect_error(format('update bookings set status = %L where id = %L', 'in_progress', v_id), '%Illegal booking transition%');
  -- assigned needs a provider (check constraint)
  perform pg_temp.expect_error(format('update bookings set status = %L where id = %L', 'assigned', v_id), '%provider_when_assigned%');

  -- 3. A booking cannot be inserted in a later state.
  perform pg_temp.expect_error(
    $q$insert into bookings (customer_id, service_id, status, address_text, location, base_price, total)
       select 't_customer', id, 'assigned', 'x', st_setsrid(st_makepoint(77.1, 28.4), 4326)::geography, 1, 1 from services limit 1$q$,
    '%must start in searching%');

  -- 4. Totals must add up.
  perform pg_temp.expect_error(format('update bookings set total = 1 where id = %L', v_id), '%total_matches%');

  -- 5. Unapproved partners cannot go online.
  perform pg_temp.expect_error($q$update provider_profiles set is_online = true where user_id = 't_pending'$q$, '%online_requires_kyc%');

  -- 6. Candidates: online, approved cleaning partners within 5 km, nearest first.
  select count(*), (array_agg(provider_id order by ord))[1] into v_n, v_first
  from (select provider_id, row_number() over () as ord from booking_candidates(v_id, 5, 10)) c;
  if v_n < 2 then raise exception 'expected at least 2 candidates, got %', v_n; end if;
  if exists (select 1 from booking_candidates(v_id, 5, 10) c join provider_profiles p on p.user_id = c.provider_id where not p.is_online) then
    raise exception 'offline partner returned as candidate';
  end if;
  if exists (select 1 from booking_candidates(v_id, 5, 10) where provider_id = 'seed_priya') then
    raise exception 'salon partner returned for a cleaning booking';
  end if;

  -- 7. Offer + accept. One open offer per booking.
  insert into booking_offers (booking_id, provider_id, rank, expires_at)
  values (v_id, v_first, 1, now() + interval '45 seconds') returning id into v_offer;
  perform pg_temp.expect_error(
    format($q$insert into booking_offers (booking_id, provider_id, rank, expires_at) values (%L, 'seed_neha', 2, now() + interval '45 seconds')$q$, v_id),
    '%booking_offers_one_open_per_booking%');

  -- Wrong partner cannot accept someone else's offer.
  perform pg_temp.expect_error(format($q$select accept_booking_offer(%L, 'seed_neha')$q$, v_offer), '%Offer not found%');

  v_b := accept_booking_offer(v_offer, v_first);
  if v_b.status <> 'assigned' or v_b.provider_id <> v_first or v_b.assigned_at is null then
    raise exception 'accept did not assign: % %', v_b.status, v_b.provider_id;
  end if;
  -- Second accept on the same offer fails.
  perform pg_temp.expect_error(format('select accept_booking_offer(%L, %L)', v_offer, v_first), '%no longer available%');

  -- Busy partner is no longer a candidate for other bookings.
  if exists (
    select 1 from bookings b2 cross join lateral booking_candidates(b2.id, 5, 20) c
    where b2.id <> v_id and c.provider_id = v_first
  ) then raise exception 'busy partner still a candidate'; end if;

  -- 8. Partner drops out -> back to searching, provider cleared.
  update bookings set status = 'searching' where id = v_id;
  select * into v_b from bookings where id = v_id;
  if v_b.provider_id is not null then raise exception 'provider not cleared on re-dispatch'; end if;
  -- The same partner is not offered again.
  if exists (select 1 from booking_candidates(v_id, 5, 10) where provider_id = v_first) then
    raise exception 'partner re-offered after dropping out';
  end if;

  -- Expired offers cannot be accepted.
  select provider_id into v_first from booking_candidates(v_id, 5, 1);
  insert into booking_offers (booking_id, provider_id, rank, expires_at)
  values (v_id, v_first, 2, now() - interval '1 second') returning id into v_offer2;
  perform pg_temp.expect_error(format('select accept_booking_offer(%L, %L)', v_offer2, v_first), '%no longer available%');
  update booking_offers set status = 'expired' where id = v_offer2;
  insert into booking_offers (booking_id, provider_id, rank, expires_at)
  values (v_id, 'seed_amit', 3, now() + interval '45 seconds') returning id into v_offer2;
  v_b := accept_booking_offer(v_offer2, 'seed_amit');

  -- 9. Happy path to in_progress; cancel is blocked once work started.
  update bookings set status = 'en_route' where id = v_id;
  update bookings set status = 'arrived' where id = v_id;
  update bookings set status = 'in_progress' where id = v_id;
  perform pg_temp.expect_error(format('update bookings set status = %L where id = %L', 'cancelled', v_id), '%Illegal booking transition%');

  -- 10. Completion needs payment.
  perform pg_temp.expect_error(format('update bookings set status = %L where id = %L', 'completed', v_id), '%before payment is confirmed%');
  insert into payments (booking_id, method, amount, status, confirmed_by, paid_at)
  values (v_id, 'cash', 299, 'paid', 'seed_amit', now());
  perform pg_temp.expect_error(
    format($q$insert into payments (booking_id, method, amount, status) values (%L, 'upi', 299, 'paid')$q$, v_id),
    '%payments_one_paid_per_booking%');
  perform set_config('serwish.actor_id', 'seed_amit', true);
  perform set_config('serwish.actor_role', 'provider', true);
  update bookings set payment_status = 'paid', payment_method = 'cash' where id = v_id;
  update bookings set status = 'completed' where id = v_id;

  -- Earnings credited once; job counted.
  select count(*) into v_n from provider_earnings where booking_id = v_id and amount = 299;
  if v_n <> 1 then raise exception 'earnings not credited'; end if;
  if (select actor_role from booking_events where booking_id = v_id and to_status = 'completed') <> 'provider' then
    raise exception 'actor not recorded';
  end if;
  -- Terminal.
  perform pg_temp.expect_error(format('update bookings set status = %L where id = %L', 'searching', v_id), '%Illegal booking transition%');

  -- 11. Reviews: one per booking, rating 1-5, aggregate refreshed.
  perform pg_temp.expect_error(
    format($q$insert into reviews (booking_id, customer_id, provider_id, rating) values (%L, 't_customer', 'seed_amit', 6)$q$, v_id),
    '%rating%');
  insert into reviews (booking_id, customer_id, provider_id, rating) values (v_id, 't_customer', 'seed_amit', 4);
  if (select rating_count from provider_profiles where user_id = 'seed_amit') <> 1
     or (select rating_avg from provider_profiles where user_id = 'seed_amit') <> 4.00 then
    raise exception 'rating aggregate not refreshed';
  end if;
  perform pg_temp.expect_error(
    format($q$insert into reviews (booking_id, customer_id, provider_id, rating) values (%L, 't_customer', 'seed_amit', 5)$q$, v_id),
    '%reviews_booking_id_key%');

  -- 12. nearby_providers: radius, category filter, sort.
  select count(*) into v_n from nearby_providers(28.4231, 77.1036, 5, 'salon');
  if v_n <> 1 then raise exception 'salon filter expected 1, got %', v_n; end if;
  select count(*) into v_n from nearby_providers(28.4231, 77.1036, 5, 'cleaning', null, 'distance', true);
  if v_n < 3 then raise exception 'online cleaning partners expected >= 3, got %', v_n; end if;
  if exists (select 1 from nearby_providers(28.4231, 77.1036, 5) where distance_km > 5) then
    raise exception 'radius not applied';
  end if;
  if (select provider_id from nearby_providers(28.4231, 77.1036, 10, null, null, 'rating') limit 1) <> 'seed_priya' then
    raise exception 'rating sort wrong';
  end if;

  -- 13. Addresses: one default per user.
  insert into addresses (user_id, line1, city, pincode, location, is_default)
  values ('t_customer', 'B-120, Sector 56', 'Gurugram', '122011', st_setsrid(st_makepoint(77.1036, 28.4231), 4326)::geography, true);
  perform pg_temp.expect_error(
    $q$insert into addresses (user_id, line1, city, pincode, location, is_default)
       values ('t_customer', 'Tower 10', 'Gurugram', '122002', st_setsrid(st_makepoint(77.09, 28.49), 4326)::geography, true)$q$,
    '%addresses_one_default%');

  raise notice 'SerWish v2 checks: all passed';
end $$;

-- 14. Lockdown: client roles see nothing (only where Supabase roles exist).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.users', 'select') or has_table_privilege('authenticated', 'public.bookings', 'select') then
      raise exception 'client roles can read tables';
    end if;
    if has_function_privilege('anon', 'public.accept_booking_offer(uuid, text)', 'execute') then
      raise exception 'anon can execute RPCs';
    end if;
    if not has_function_privilege('service_role', 'public.accept_booking_offer(uuid, text)', 'execute') then
      raise exception 'service_role cannot execute RPCs';
    end if;
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys' and not rowsecurity) then
    raise exception 'a public table has RLS disabled';
  end if;
  raise notice 'SerWish v2 lockdown checks: all passed';
end $$;

rollback;

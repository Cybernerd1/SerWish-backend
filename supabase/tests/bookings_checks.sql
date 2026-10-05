-- =============================================================================
-- SerWish booking lifecycle checks (dispatcher, partner moves, completion,
-- cancellation). Runs in one transaction and rolls back.
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

insert into users (id, name, phone) values ('bc_customer', 'Booking Customer', '9876511111');

create temp table t as
select gen_random_uuid() as b1, gen_random_uuid() as b2, gen_random_uuid() as b3;

-- b1: cleaning, now, preferred partner Neha (further away than Ravi)
insert into bookings (id, customer_id, service_id, preferred_provider_id, address_text, location, base_price, total)
select t.b1, 'bc_customer', s.id, 'seed_neha', 'B-120, Sector 56', st_setsrid(st_makepoint(77.1036, 28.4231), 4326)::geography, 299, 299
from t, services s where s.slug = 'home-clean';

-- b2: cleaning, scheduled in 3 days (not due for dispatch yet)
insert into bookings (id, customer_id, service_id, schedule_type, scheduled_at, address_text, location, base_price, total)
select t.b2, 'bc_customer', s.id, 'later', now() + interval '3 days', 'B-120, Sector 56',
       st_setsrid(st_makepoint(77.1036, 28.4231), 4326)::geography, 299, 299
from t, services s where s.slug = 'home-clean';

-- b3: salon far away (Mumbai): nobody in range
insert into bookings (id, customer_id, service_id, address_text, location, base_price, total)
select t.b3, 'bc_customer', s.id, 'Bandra, Mumbai', st_setsrid(st_makepoint(72.8347, 19.0596), 4326)::geography, 399, 399
from t, services s where s.slug = 'hair';

do $$
declare
  v_b1 uuid := (select b1 from t);
  v_b2 uuid := (select b2 from t);
  v_b3 uuid := (select b3 from t);
  r record;
  v_offer uuid;
  v_first text;
  v_n int;
  v bookings;
begin
  -- 1. First tick: b1 offered to the preferred partner; b2 not due; b3 has nobody yet (not timed out).
  for r in select * from dispatch_tick(45, 5, 300, 60) loop
    if r.booking_id = v_b1 then v_offer := r.offer_id; v_first := r.provider_id; end if;
    if r.booking_id = v_b2 then raise exception 'scheduled booking dispatched too early'; end if;
    if r.booking_id = v_b3 then raise exception 'unexpected event for b3: %', r.kind; end if;
  end loop;
  if v_first is distinct from 'seed_neha' then raise exception 'preferred partner not offered first: %', v_first; end if;
  if (select dispatch_started_at from bookings where id = v_b2) is not null then raise exception 'b2 started early'; end if;

  -- 2. A second tick does nothing for b1 (offer still open).
  select count(*) into v_n from dispatch_tick(45, 5, 300, 60) d where d.booking_id = v_b1;
  if v_n <> 0 then raise exception 'second offer while one is open'; end if;

  -- 3. Partner rejects -> next tick offers to the next nearest partner.
  perform pg_temp.expect_error(format($q$select reject_booking_offer(%L, 'seed_ravi')$q$, v_offer), '%Offer not found%');
  perform reject_booking_offer(v_offer, 'seed_neha');
  select d.offer_id, d.provider_id into v_offer, v_first from dispatch_tick(45, 5, 300, 60) d
   where d.booking_id = v_b1 and d.kind = 'offer_new';
  if v_first is null or v_first = 'seed_neha' then raise exception 'no re-offer after reject (%).', v_first; end if;

  -- 4. Expiry: force the open offer to expire -> expired event + next partner.
  update booking_offers set expires_at = now() - interval '1 second' where id = v_offer;
  select count(*) into v_n from dispatch_tick(45, 5, 300, 60) d where d.booking_id = v_b1 and d.kind = 'offer_expired';
  if v_n <> 1 then raise exception 'expired offer not reported'; end if;
  if (select status from booking_offers where id = v_offer) <> 'expired' then raise exception 'offer not expired'; end if;
  select o.id, o.provider_id into v_offer, v_first from booking_offers o where o.booking_id = v_b1 and o.status = 'offered';
  if v_offer is null then raise exception 'no next offer after expiry'; end if;

  -- 5. Accept, then partner moves. Wrong partner / wrong order are refused.
  v := accept_booking_offer(v_offer, v_first);
  perform pg_temp.expect_error(format($q$select partner_transition(%L, 'seed_priya', 'en_route')$q$, v_b1), '%Booking not found%');
  perform pg_temp.expect_error(format($q$select partner_transition(%L, %L, 'in_progress')$q$, v_b1, v_first), '%Illegal booking transition%');
  perform pg_temp.expect_error(format($q$select partner_transition(%L, %L, 'completed')$q$, v_b1, v_first), '%completion or cancel%');

  -- 6. Partner drops out while en route -> back to searching, not offered again.
  perform partner_transition(v_b1, v_first, 'en_route');
  perform partner_transition(v_b1, v_first, 'en_route'); -- idempotent
  v := cancel_booking(v_b1, v_first, 'provider', 'Bike broke down');
  if v.status <> 'searching' or v.provider_id is not null then raise exception 'partner drop did not re-dispatch'; end if;
  if (select meta->>'reason' from booking_events where booking_id = v_b1 order by id desc limit 1) <> 'Bike broke down' then
    raise exception 'drop reason not recorded';
  end if;
  if exists (select 1 from dispatch_tick(45, 5, 300, 60) d where d.booking_id = v_b1 and d.provider_id = v_first) then
    raise exception 'dropped partner re-offered';
  end if;

  -- 7. Next partner accepts and completes; amount must match; payment recorded once.
  select o.id, o.provider_id into v_offer, v_first from booking_offers o where o.booking_id = v_b1 and o.status = 'offered';
  v := accept_booking_offer(v_offer, v_first);
  perform partner_transition(v_b1, v_first, 'en_route');
  perform partner_transition(v_b1, v_first, 'arrived');
  perform pg_temp.expect_error(format($q$select complete_booking(%L, %L, 'cash', 299)$q$, v_b1, v_first), '%Start the job%');
  perform partner_transition(v_b1, v_first, 'in_progress');
  perform pg_temp.expect_error(format($q$select cancel_booking(%L, 'bc_customer', 'customer', 'x')$q$, v_b1), '%can no longer be cancelled%');
  perform pg_temp.expect_error(format($q$select complete_booking(%L, %L, 'cash', 199)$q$, v_b1, v_first), '%must be the booking total%');
  v := complete_booking(v_b1, v_first, 'cash', 299);
  if v.status <> 'completed' or v.payment_status <> 'paid' or v.payment_method <> 'cash' then raise exception 'completion failed'; end if;
  v := complete_booking(v_b1, v_first, 'cash', 299); -- idempotent retry
  select count(*) into v_n from payments where booking_id = v_b1;
  if v_n <> 1 then raise exception 'payment recorded % times', v_n; end if;
  if (select confirmed_by from payments where booking_id = v_b1) <> v_first then raise exception 'confirmer not stored'; end if;

  -- 8. Customer cancels b2 before dispatch; cannot cancel twice.
  v := cancel_booking(v_b2, 'bc_customer', 'customer', 'Change in plans');
  if v.status <> 'cancelled' or v.cancelled_by <> 'customer' or v.cancel_reason <> 'Change in plans' then raise exception 'customer cancel failed'; end if;
  perform pg_temp.expect_error(format($q$select cancel_booking(%L, 'bc_customer', 'customer', 'x')$q$, v_b2), '%already cancelled%');
  perform pg_temp.expect_error(format($q$select cancel_booking(%L, 'someone_else', 'customer', 'x')$q$, v_b1), '%Booking not found%');

  -- 9. Matching timeout -> no_providers.
  update bookings set dispatch_started_at = now() - interval '10 minutes' where id = v_b3;
  select count(*) into v_n from dispatch_tick(45, 5, 300, 60) d where d.booking_id = v_b3 and d.kind = 'no_providers';
  if v_n <> 1 or (select status from bookings where id = v_b3) <> 'no_providers' then raise exception 'timeout did not end the search'; end if;
  if (select actor_role from booking_events where booking_id = v_b3 order by id desc limit 1) <> 'system' then
    raise exception 'dispatcher actor not recorded';
  end if;

  -- 10. Idempotency key is unique per customer.
  update bookings set idempotency_key = 'key-12345678' where id = v_b2;
  perform pg_temp.expect_error(format($q$update bookings set idempotency_key = 'key-12345678' where id = %L$q$, v_b3), '%bookings_idempotency_idx%');

  raise notice 'SerWish booking checks: all passed';
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.dispatch_tick(int, double precision, int, int, int)', 'execute') then
    raise exception 'anon can run the dispatcher';
  end if;
  raise notice 'SerWish booking lockdown checks: all passed';
end $$;

rollback;

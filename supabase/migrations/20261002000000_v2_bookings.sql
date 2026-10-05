-- =============================================================================
-- SerWish v2 - Backend Phase 2/3: booking lifecycle API support
-- =============================================================================
-- * Idempotent booking creation (Idempotency-Key per customer)
-- * Dispatcher: one partner at a time, 45 s offers, preferred partner first,
--   overall matching timeout -> no_providers. Runs as one SQL function so it is
--   atomic and safe with several API instances (advisory lock).
-- * Partner moves: en_route / arrived / in_progress, completion after the
--   partner confirms payment (owner decision), cancellation rules.
-- All functions are SECURITY INVOKER and executable by service_role only.
-- =============================================================================

set search_path = public, extensions;

-- Coupons that only apply to a customer's first booking (e.g. SERWISH50).
alter table offers add column if not exists first_booking_only boolean not null default false;

alter table bookings add column if not exists idempotency_key text check (char_length(idempotency_key) between 8 and 80);
alter table bookings add column if not exists dispatch_started_at timestamptz;
-- Plain numbers for the API (PostgREST cannot render geography as JSON).
alter table bookings add column if not exists lat double precision generated always as (st_y(location::geometry)) stored;
alter table bookings add column if not exists lng double precision generated always as (st_x(location::geometry)) stored;
create unique index if not exists bookings_idempotency_idx on bookings (customer_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists bookings_dispatch_idx on bookings (scheduled_at) where status = 'searching';
create index if not exists booking_offers_expiry_idx on booking_offers (expires_at) where status = 'offered';

-- -----------------------------------------------------------------------------
-- Dispatcher tick. Call every ~2 s (and right after a booking is created or an
-- offer is rejected). Returns what changed so the API can notify sockets.
--   kind = 'offer_new' | 'offer_expired' | 'no_providers'
-- -----------------------------------------------------------------------------
create or replace function dispatch_tick(
  p_offer_seconds    int default 45,
  p_radius_km        double precision default 5,
  p_timeout_seconds  int default 300,
  p_lead_minutes     int default 60,
  p_batch            int default 50
)
returns table (kind text, booking_id uuid, offer_id uuid, provider_id text, distance_km double precision)
language plpgsql set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  b record;
  c record;
  v_offer uuid;
  v_rank int;
begin
  -- One dispatcher at a time across all API instances.
  if not pg_try_advisory_xact_lock(hashtext('serwish.dispatch_tick')) then
    return;
  end if;

  -- 1. Expire offers whose window has passed.
  return query
    with expired as (
      update booking_offers o set status = 'expired', responded_at = now()
       where o.status = 'offered' and o.expires_at <= now()
      returning o.booking_id, o.id, o.provider_id, o.distance_km::double precision
    )
    select 'offer_expired'::text, e.booking_id, e.id, e.provider_id, e.distance_km from expired e;

  -- 2. Searching bookings that are due and have no open offer.
  for b in
    select bk.id, bk.created_at, bk.dispatch_started_at
      from bookings bk
     where bk.status = 'searching'
       and bk.scheduled_at - make_interval(mins => p_lead_minutes) <= now()
       and not exists (select 1 from booking_offers o where o.booking_id = bk.id and o.status = 'offered')
     order by bk.scheduled_at
     limit p_batch
     for update skip locked
  loop
    if b.dispatch_started_at is null then
      update bookings set dispatch_started_at = now() where id = b.id;
      b.dispatch_started_at := now();
    end if;

    select * into c from booking_candidates(b.id, p_radius_km, 1) limit 1;

    if found then
      select coalesce(max(o.rank), 0) + 1 into v_rank from booking_offers o where o.booking_id = b.id;
      insert into booking_offers (booking_id, provider_id, rank, distance_km, expires_at)
      values (b.id, c.provider_id, v_rank, c.distance_km, now() + make_interval(secs => p_offer_seconds))
      returning id into v_offer;
      kind := 'offer_new'; booking_id := b.id; offer_id := v_offer; provider_id := c.provider_id; distance_km := c.distance_km;
      return next;
    elsif b.dispatch_started_at + make_interval(secs => p_timeout_seconds) <= now() then
      perform set_config('serwish.actor_id', 'dispatcher', true);
      perform set_config('serwish.actor_role', 'system', true);
      update bookings set status = 'no_providers' where id = b.id;
      kind := 'no_providers'; booking_id := b.id; offer_id := null; provider_id := null; distance_km := null;
      return next;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Partner declines an open offer. The next tick offers the job to someone else.
-- -----------------------------------------------------------------------------
create or replace function reject_booking_offer(p_offer_id uuid, p_provider_id text)
returns booking_offers
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_offer booking_offers;
begin
  select * into v_offer from booking_offers where id = p_offer_id for update;
  if not found or v_offer.provider_id <> p_provider_id then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'Offer is no longer available' using errcode = 'P0001';
  end if;
  update booking_offers set status = 'rejected', responded_at = now() where id = p_offer_id
  returning * into v_offer;
  return v_offer;
end $$;

-- -----------------------------------------------------------------------------
-- Assigned partner moves the job forward: en_route -> arrived -> in_progress.
-- -----------------------------------------------------------------------------
create or replace function partner_transition(p_booking_id uuid, p_provider_id text, p_to booking_status)
returns bookings
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v bookings;
begin
  if p_to not in ('en_route', 'arrived', 'in_progress') then
    raise exception 'Use the completion or cancel endpoint for %', p_to using errcode = 'P0001';
  end if;
  select * into v from bookings where id = p_booking_id for update;
  if not found or v.provider_id is distinct from p_provider_id then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v.status = p_to then
    return v; -- idempotent retry
  end if;
  perform set_config('serwish.actor_id', p_provider_id, true);
  perform set_config('serwish.actor_role', 'provider', true);
  update bookings set status = p_to where id = p_booking_id returning * into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Completion (owner decision): the partner confirms they received the full
-- amount (cash or UPI to the partner), then the job completes. Records the
-- payment once; the completion trigger credits earnings once.
-- -----------------------------------------------------------------------------
create or replace function complete_booking(p_booking_id uuid, p_provider_id text, p_method payment_method, p_amount int)
returns bookings
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v bookings;
begin
  select * into v from bookings where id = p_booking_id for update;
  if not found or v.provider_id is distinct from p_provider_id then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v.status = 'completed' then
    return v; -- idempotent retry
  end if;
  if v.status <> 'in_progress' then
    raise exception 'Start the job before completing it' using errcode = 'P0001';
  end if;
  if p_amount <> v.total then
    raise exception 'Collected amount must be the booking total (%)', v.total using errcode = 'P0001';
  end if;

  if v.payment_status <> 'paid' then
    insert into payments (booking_id, method, amount, status, confirmed_by, paid_at)
    values (v.id, p_method, v.total, 'paid', p_provider_id, now());
    update bookings set payment_status = 'paid', payment_method = p_method where id = v.id;
  end if;

  perform set_config('serwish.actor_id', p_provider_id, true);
  perform set_config('serwish.actor_role', 'provider', true);
  update bookings set status = 'completed' where id = v.id returning * into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Cancellation (rule 4.7: never once work has started; no fee for now).
--   customer: searching | assigned | en_route | arrived -> cancelled
--   partner:  assigned | en_route -> back to searching (re-dispatch)
--             arrived -> cancelled (e.g. customer not reachable)
-- -----------------------------------------------------------------------------
create or replace function cancel_booking(p_booking_id uuid, p_actor_id text, p_role actor_role, p_reason text)
returns bookings
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v bookings;
  v_to booking_status;
begin
  select * into v from bookings where id = p_booking_id for update;
  if not found
     or (p_role = 'customer' and v.customer_id <> p_actor_id)
     or (p_role = 'provider' and v.provider_id is distinct from p_actor_id) then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v.status in ('cancelled', 'no_providers', 'completed') then
    raise exception 'This booking is already %', v.status using errcode = 'P0001';
  end if;
  if v.status = 'in_progress' then
    raise exception 'The job has started and can no longer be cancelled' using errcode = 'P0001';
  end if;

  if p_role = 'provider' and v.status in ('assigned', 'en_route') then
    v_to := 'searching';
  else
    v_to := 'cancelled';
  end if;

  perform set_config('serwish.actor_id', p_actor_id, true);
  perform set_config('serwish.actor_role', p_role::text, true);

  update booking_offers set status = 'cancelled', responded_at = now()
   where booking_id = v.id and status = 'offered';

  if v_to = 'cancelled' then
    update bookings
       set status = 'cancelled', cancelled_by = p_role, cancel_reason = left(p_reason, 300)
     where id = v.id
    returning * into v;
  else
    -- Re-dispatch with a fresh matching window; the dropped partner is never re-offered.
    update bookings set status = 'searching', dispatch_started_at = now() where id = v.id
    returning * into v;
    update booking_events set meta = meta || jsonb_build_object('reason', left(p_reason, 300))
     where id = (select max(id) from booking_events where booking_id = v.id);
  end if;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Lock down the new functions like the rest.
-- -----------------------------------------------------------------------------
revoke execute on function dispatch_tick(int, double precision, int, int, int) from public;
revoke execute on function reject_booking_offer(uuid, text) from public;
revoke execute on function partner_transition(uuid, text, booking_status) from public;
revoke execute on function complete_booking(uuid, text, payment_method, int) from public;
revoke execute on function cancel_booking(uuid, text, actor_role, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
    execute 'grant all on all tables in schema public to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on all functions in schema public from authenticated';
  end if;
end $$;

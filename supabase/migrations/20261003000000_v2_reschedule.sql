-- =============================================================================
-- SerWish v2 - reschedule a booking (Reschedule screen)
-- Allowed while nobody has started travelling: searching or assigned.
-- An assigned partner is released (the new slot may not suit them) and the job
-- is offered again near the new time. No fee (owner decision).
-- =============================================================================
set search_path = public, extensions;

create or replace function reschedule_booking(p_booking_id uuid, p_customer_id text, p_at timestamptz)
returns bookings
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v bookings;
begin
  select * into v from bookings where id = p_booking_id for update;
  if not found or v.customer_id <> p_customer_id then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v.status not in ('searching', 'assigned') then
    raise exception 'This booking can no longer be rescheduled' using errcode = 'P0001';
  end if;
  if p_at < now() + interval '30 minutes' then
    raise exception 'Pick a slot at least 30 minutes from now' using errcode = 'P0001';
  end if;

  perform set_config('serwish.actor_id', p_customer_id, true);
  perform set_config('serwish.actor_role', 'customer', true);
  update booking_offers set status = 'cancelled', responded_at = now()
   where booking_id = v.id and status = 'offered';
  if v.status = 'assigned' then
    update bookings set status = 'searching' where id = v.id;
  end if;
  update bookings
     set schedule_type = 'later', scheduled_at = p_at, dispatch_started_at = null
   where id = v.id
  returning * into v;
  return v;
end $$;

revoke execute on function reschedule_booking(uuid, text, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function reschedule_booking(uuid, text, timestamptz) to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function reschedule_booking(uuid, text, timestamptz) from anon';
  end if;
end $$;

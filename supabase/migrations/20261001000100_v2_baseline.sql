-- =============================================================================
-- SerWish v2 - step 2 of 2: baseline schema
-- =============================================================================
-- Conventions
--   * User ids are Firebase UIDs (text). Every other id is a uuid.
--   * Money is whole rupees (integer). Razorpay amounts (paise) are derived.
--   * Row Level Security is ON for every table with no policies: only the
--     backend (service role) can read or write. anon/authenticated get nothing.
--   * Business rules that must never be broken live in the database:
--     booking state machine, one review per booking, one offer per provider.
-- Owner decisions reflected here (plan doc, 2026-10-01):
--   * matching radius 5 km, job offer window 45 s (backend config)
--   * no platform fee, no cancellation fee, no in-app wallet
--   * partner completes a job only after confirming payment (cash or UPI)
-- =============================================================================

set search_path = public, extensions;

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type kyc_status as enum ('not_started', 'pending', 'approved', 'rejected');

create type booking_status as enum (
  'searching',     -- dispatcher is offering the job to partners
  'assigned',      -- a partner accepted
  'en_route',      -- partner started travelling
  'arrived',       -- partner is at the address
  'in_progress',   -- work started
  'completed',     -- partner finished (after payment was confirmed)
  'cancelled',
  'no_providers'   -- nobody accepted before the matching timeout
);

create type offer_status as enum ('offered', 'accepted', 'rejected', 'expired', 'cancelled');
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type payment_method as enum ('upi', 'card', 'netbanking', 'cash');
create type schedule_type as enum ('now', 'later');
create type actor_role as enum ('customer', 'provider', 'system', 'admin');
create type address_label as enum ('home', 'work', 'other');

-- -----------------------------------------------------------------------------
-- Shared trigger: updated_at
-- -----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Accounts
-- -----------------------------------------------------------------------------
create table users (
  id            text primary key,                       -- Firebase UID
  name          text check (char_length(name) between 2 and 80),
  email         text unique,
  phone         text unique check (phone ~ '^[6-9][0-9]{9}$'),
  photo_url     text,
  city          text,
  is_admin      boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger users_updated_at before update on users for each row execute function set_updated_at();

create table addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users (id) on delete cascade,
  label       address_label not null default 'home',
  line1       text not null check (char_length(line1) between 3 and 200),
  line2       text,
  city        text not null,
  pincode     text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  location    geography(point, 4326) not null,
  -- Plain numbers for the API (PostgREST cannot render geography as JSON).
  lat         double precision generated always as (st_y(location::geometry)) stored,
  lng         double precision generated always as (st_x(location::geometry)) stored,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index addresses_user_idx on addresses (user_id) where deleted_at is null;
create unique index addresses_one_default on addresses (user_id) where is_default and deleted_at is null;
create trigger addresses_updated_at before update on addresses for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Catalogue
-- -----------------------------------------------------------------------------
create table categories (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name           text not null,
  icon           text not null,                 -- app icon key, e.g. 'cleaning'
  image_url      text,
  group_name     text not null,                 -- left rail on All Categories
  tagline        text,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger categories_updated_at before update on categories for each row execute function set_updated_at();

create table services (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references categories (id),
  slug           text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name           text not null,
  subtitle       text,
  description    text,
  image_url      text,
  base_price     int not null check (base_price > 0),
  duration_mins  int not null check (duration_mins > 0),
  included       text[] not null default '{}',
  rating_avg     numeric(3, 2),
  rating_count   int not null default 0,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index services_category_idx on services (category_id) where is_active;
create index services_name_search_idx on services using gin (to_tsvector('simple', name || ' ' || coalesce(subtitle, '')));
create trigger services_updated_at before update on services for each row execute function set_updated_at();

create table service_packages (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid not null references services (id) on delete cascade,
  name           text not null,
  price          int not null check (price > 0),
  duration_mins  int not null check (duration_mins > 0),
  pros_count     int not null default 1 check (pros_count between 1 and 10),
  includes       text[] not null default '{}',
  is_popular     boolean not null default false,
  display_order  int not null default 0
);
create index service_packages_service_idx on service_packages (service_id);

create table service_extras (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references services (id) on delete cascade,
  name        text not null,
  price       int not null check (price > 0),
  display_order int not null default 0
);
create index service_extras_service_idx on service_extras (service_id);

create table offers (
  code          text primary key check (code ~ '^[A-Z0-9]{3,20}$'),
  title         text not null,
  description   text,
  kind          text not null check (kind in ('percent', 'flat')),
  value         int not null check (value > 0),
  max_discount  int check (max_discount > 0),
  min_order     int check (min_order > 0),
  category_id   uuid references categories (id),
  valid_from    timestamptz,
  valid_to      timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);

-- -----------------------------------------------------------------------------
-- Partners (providers)
-- A partner is a user with a provider profile; the same account can book
-- services as a customer. KYC must be approved before going online.
-- -----------------------------------------------------------------------------
create table provider_profiles (
  user_id               text primary key references users (id) on delete cascade,
  headline              text check (char_length(headline) <= 60),   -- e.g. 'Home Cleaning Expert'
  bio                   text check (char_length(bio) <= 600),
  service_areas         text[] not null default '{}',                -- localities shown on the profile
  years_experience      int not null default 0 check (years_experience between 0 and 60),
  languages             text[] not null default '{}',
  hourly_rate           int check (hourly_rate > 0),
  kyc_status            kyc_status not null default 'not_started',
  kyc_id_doc_path       text,     -- object path in the private 'kyc' bucket, never a public URL
  kyc_cert_doc_path     text,
  kyc_submitted_at      timestamptz,
  kyc_reviewed_at       timestamptz,
  kyc_reviewed_by       text references users (id),
  kyc_rejection_reason  text,
  is_online             boolean not null default false,
  current_location      geography(point, 4326),
  location_updated_at   timestamptz,
  last_seen_at          timestamptz,
  rating_avg            numeric(3, 2),            -- null until the first review
  rating_count          int not null default 0,
  total_jobs            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Rule 4.4: only approved partners can be online.
  constraint online_requires_kyc check (not is_online or kyc_status = 'approved'),
  constraint kyc_submission_has_docs check (
    kyc_status in ('not_started') or (kyc_id_doc_path is not null and kyc_cert_doc_path is not null)
  )
);
create index provider_location_idx on provider_profiles using gist (current_location);
create index provider_online_idx on provider_profiles (is_online) where is_online;
create trigger provider_profiles_updated_at before update on provider_profiles for each row execute function set_updated_at();

create table provider_categories (
  provider_id  text not null references provider_profiles (user_id) on delete cascade,
  category_id  uuid not null references categories (id),
  primary key (provider_id, category_id)
);
create index provider_categories_category_idx on provider_categories (category_id);

create table provider_gallery (
  id           uuid primary key default gen_random_uuid(),
  provider_id  text not null references provider_profiles (user_id) on delete cascade,
  image_url    text not null,
  created_at   timestamptz not null default now()
);
create index provider_gallery_provider_idx on provider_gallery (provider_id);

-- -----------------------------------------------------------------------------
-- Bookings
-- -----------------------------------------------------------------------------
create table bookings (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique default ('SW' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  customer_id            text not null references users (id),
  provider_id            text references provider_profiles (user_id),
  preferred_provider_id  text references provider_profiles (user_id),
  service_id             uuid not null references services (id),
  package_id             uuid references service_packages (id),
  status                 booking_status not null default 'searching',
  schedule_type          schedule_type not null default 'now',
  scheduled_at           timestamptz not null default now(),
  -- Address snapshot: history stays correct if the address book changes.
  address_id             uuid references addresses (id) on delete set null,
  address_text           text not null,
  location               geography(point, 4326) not null,
  notes                  text check (char_length(notes) <= 500),
  -- Price snapshot, computed by the server before confirmation (no surprises).
  extras                 jsonb not null default '[]',   -- [{id, name, price}]
  base_price             int not null check (base_price > 0),
  extras_total           int not null default 0 check (extras_total >= 0),
  discount               int not null default 0 check (discount >= 0),
  platform_fee           int not null default 0 check (platform_fee >= 0),  -- owner decision: 0 for now
  total                  int not null check (total >= 0),
  coupon_code            text references offers (code),
  payment_method         payment_method not null default 'upi',
  payment_status         payment_status not null default 'pending',
  -- Optional completion code (OTP). Only a bcrypt hash is stored; never returned by the API.
  otp_hash               text,
  otp_attempts           int not null default 0,
  otp_expires_at         timestamptz,
  cancelled_by           actor_role,
  cancel_reason          text,
  assigned_at            timestamptz,
  en_route_at            timestamptz,
  arrived_at             timestamptz,
  started_at             timestamptz,
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint total_matches check (total = base_price + extras_total + platform_fee - discount),
  constraint provider_when_assigned check (
    status in ('searching', 'cancelled', 'no_providers') or provider_id is not null
  ),
  constraint later_is_future check (schedule_type = 'now' or scheduled_at > created_at)
);
create index bookings_customer_idx on bookings (customer_id, created_at desc);
create index bookings_provider_idx on bookings (provider_id, created_at desc) where provider_id is not null;
create index bookings_status_idx on bookings (status) where status in ('searching', 'assigned', 'en_route', 'arrived', 'in_progress');
create index bookings_service_idx on bookings (service_id);
-- A partner can hold only one active job at a time (also closes the accept race).
create unique index bookings_one_active_job_per_provider on bookings (provider_id)
  where status in ('assigned', 'en_route', 'arrived', 'in_progress');
create trigger bookings_updated_at before update on bookings for each row execute function set_updated_at();

-- Audit trail of every status change (written by the state-machine trigger).
create table booking_events (
  id           bigint generated always as identity primary key,
  booking_id   uuid not null references bookings (id) on delete cascade,
  from_status  booking_status,
  to_status    booking_status not null,
  actor_id     text,
  actor_role   actor_role,
  meta         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index booking_events_booking_idx on booking_events (booking_id, created_at);

-- One row per partner offered a job (dispatcher, rule 4.3).
create table booking_offers (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings (id) on delete cascade,
  provider_id   text not null references provider_profiles (user_id),
  status        offer_status not null default 'offered',
  rank          int not null,
  distance_km   numeric(6, 2),
  offered_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  responded_at  timestamptz,
  unique (booking_id, provider_id)
);
create index booking_offers_provider_open_idx on booking_offers (provider_id) where status = 'offered';
create index booking_offers_booking_idx on booking_offers (booking_id);
create unique index booking_offers_one_open_per_booking on booking_offers (booking_id) where status = 'offered';

-- -----------------------------------------------------------------------------
-- Payments, earnings, reviews, saved items, notifications
-- -----------------------------------------------------------------------------
create table payments (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references bookings (id),
  method                payment_method not null,
  amount                int not null check (amount >= 0),
  status                payment_status not null default 'pending',
  razorpay_order_id     text unique,
  razorpay_payment_id   text unique,
  confirmed_by          text references users (id),   -- partner who confirmed a cash/UPI-to-partner payment
  created_at            timestamptz not null default now(),
  paid_at               timestamptz
);
create index payments_booking_idx on payments (booking_id);
create unique index payments_one_paid_per_booking on payments (booking_id) where status = 'paid';

create table provider_earnings (
  id           uuid primary key default gen_random_uuid(),
  provider_id  text not null references provider_profiles (user_id),
  booking_id   uuid not null unique references bookings (id),   -- credited once per booking
  amount       int not null check (amount >= 0),
  created_at   timestamptz not null default now()
);
create index provider_earnings_provider_idx on provider_earnings (provider_id, created_at desc);

create table reviews (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null unique references bookings (id),
  customer_id  text not null references users (id),
  provider_id  text not null references provider_profiles (user_id),
  rating       int not null check (rating between 1 and 5),
  tags         text[] not null default '{}',
  comment      text check (char_length(comment) <= 500),
  photos       text[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index reviews_provider_idx on reviews (provider_id, created_at desc);

create table saved_services (
  user_id     text not null references users (id) on delete cascade,
  service_id  uuid not null references services (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, service_id)
);

create table saved_providers (
  user_id      text not null references users (id) on delete cascade,
  provider_id  text not null references provider_profiles (user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, provider_id)
);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users (id) on delete cascade,
  kind        text not null check (kind in ('booking', 'offer', 'update', 'job')),
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Booking state machine (enforced in the database)
--   searching   -> assigned | cancelled | no_providers
--   assigned    -> en_route | cancelled | searching (partner dropped out: re-dispatch)
--   en_route    -> arrived  | cancelled | searching
--   arrived     -> in_progress | cancelled
--   in_progress -> completed            (no cancel once work started, rule 4.7)
--   completed / cancelled / no_providers are terminal
-- The trigger also stamps the matching timestamp and writes booking_events.
-- Actor is read from the transaction settings serwish.actor_id / serwish.actor_role.
-- -----------------------------------------------------------------------------
create or replace function booking_transition_allowed(p_from booking_status, p_to booking_status)
returns boolean language sql immutable set search_path = public, extensions, pg_temp as $$
  select case p_from
    when 'searching'   then p_to in ('assigned', 'cancelled', 'no_providers')
    when 'assigned'    then p_to in ('en_route', 'cancelled', 'searching')
    when 'en_route'    then p_to in ('arrived', 'cancelled', 'searching')
    when 'arrived'     then p_to in ('in_progress', 'cancelled')
    when 'in_progress' then p_to in ('completed')
    else false
  end
$$;

create or replace function bookings_enforce_transition() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'searching' then
      raise exception 'A booking must start in searching, not %', new.status using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not booking_transition_allowed(old.status, new.status) then
      raise exception 'Illegal booking transition % -> %', old.status, new.status using errcode = 'P0001';
    end if;

    case new.status
      when 'assigned'    then new.assigned_at := now();
      when 'en_route'    then new.en_route_at := now();
      when 'arrived'     then new.arrived_at := now();
      when 'in_progress' then new.started_at := now();
      when 'completed'   then new.completed_at := now();
      when 'cancelled'   then new.cancelled_at := now();
      when 'searching'   then
        -- Partner dropped out: free the booking for re-dispatch.
        new.provider_id := null;
        new.assigned_at := null;
        new.en_route_at := null;
      else null;
    end case;

    -- Rule: the partner completes only after the payment is confirmed.
    if new.status = 'completed' and new.payment_status <> 'paid' then
      raise exception 'Cannot complete booking % before payment is confirmed', new.code using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_state_machine
  before insert or update of status on bookings
  for each row execute function bookings_enforce_transition();

-- Audit trail. Runs AFTER the row exists so the foreign key holds.
create or replace function bookings_log_event() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_actor text := nullif(current_setting('serwish.actor_id', true), '');
  v_role  actor_role := nullif(current_setting('serwish.actor_role', true), '')::actor_role;
begin
  if tg_op = 'INSERT' then
    insert into booking_events (booking_id, from_status, to_status, actor_id, actor_role)
    values (new.id, null, new.status, coalesce(v_actor, new.customer_id), coalesce(v_role, 'customer'));
  elsif new.status is distinct from old.status then
    insert into booking_events (booking_id, from_status, to_status, actor_id, actor_role, meta)
    values (new.id, old.status, new.status, v_actor, v_role,
            case when old.provider_id is distinct from new.provider_id
                 then jsonb_build_object('previous_provider_id', old.provider_id) else '{}'::jsonb end);
  end if;
  return null;
end $$;

create trigger bookings_audit
  after insert or update of status on bookings
  for each row execute function bookings_log_event();

-- -----------------------------------------------------------------------------
-- Provider rating aggregate (rule 4.6: average of all submitted ratings)
-- -----------------------------------------------------------------------------
create or replace function refresh_provider_rating() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_provider text := coalesce(new.provider_id, old.provider_id);
begin
  update provider_profiles p
     set rating_avg = s.avg_rating,
         rating_count = s.cnt
    from (
      select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as cnt
      from reviews where provider_id = v_provider
    ) s
   where p.user_id = v_provider;
  return null;
end $$;

create trigger reviews_refresh_rating
  after insert or update or delete on reviews
  for each row execute function refresh_provider_rating();

-- Count completed jobs and credit earnings once, when a booking completes.
create or replace function bookings_on_completed() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update provider_profiles set total_jobs = total_jobs + 1 where user_id = new.provider_id;
    insert into provider_earnings (provider_id, booking_id, amount)
    values (new.provider_id, new.id, new.total - new.platform_fee)
    on conflict (booking_id) do nothing;
  end if;
  return null;
end $$;

create trigger bookings_completed_side_effects
  after update of status on bookings
  for each row execute function bookings_on_completed();

-- -----------------------------------------------------------------------------
-- RPC: partners near a point (Provider List, Home strip, Choose a Professional)
-- -----------------------------------------------------------------------------
create or replace function nearby_providers(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_km      double precision default 5,
  p_category_slug  text default null,
  p_service_id     uuid default null,
  p_sort           text default 'distance',   -- distance | rating | price
  p_online_only    boolean default false,
  p_limit          int default 20,
  p_offset         int default 0
)
returns table (
  provider_id       text,
  name              text,
  photo_url         text,
  headline          text,
  rating_avg        numeric,
  rating_count      int,
  total_jobs        int,
  hourly_rate       int,
  years_experience  int,
  is_online         boolean,
  distance_km       double precision
)
language sql stable set search_path = public, extensions, pg_temp as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  ),
  wanted_category as (
    select c.id from categories c where c.slug = p_category_slug
    union
    select s.category_id from services s where s.id = p_service_id
  )
  select p.user_id, u.name, u.photo_url, p.headline, p.rating_avg, p.rating_count, p.total_jobs,
         p.hourly_rate, p.years_experience, p.is_online,
         round((st_distance(p.current_location, o.g) / 1000)::numeric, 2)::double precision as distance_km
  from provider_profiles p
  join users u on u.id = p.user_id and u.is_active and u.deleted_at is null
  cross join origin o
  where p.kyc_status = 'approved'
    and p.current_location is not null
    and st_dwithin(p.current_location, o.g, least(greatest(p_radius_km, 0.5), 25) * 1000)
    and (not p_online_only or p.is_online)
    and (
      (p_category_slug is null and p_service_id is null)
      or exists (
        select 1 from provider_categories pc
        where pc.provider_id = p.user_id and pc.category_id in (select id from wanted_category)
      )
    )
  order by
    case when p_sort = 'rating' then coalesce(p.rating_avg, 0) end desc nulls last,
    case when p_sort = 'price' then p.hourly_rate end asc nulls last,
    st_distance(p.current_location, o.g) asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
$$;

-- -----------------------------------------------------------------------------
-- RPC: next candidates for a booking (dispatcher, rules 4.2-4.3)
-- Online, KYC-approved partners in the service's category, within the radius,
-- not on another job and not already offered this booking. Preferred partner
-- first, then nearest, then best rated.
-- -----------------------------------------------------------------------------
create or replace function booking_candidates(p_booking_id uuid, p_radius_km double precision default 5, p_limit int default 5)
returns table (provider_id text, distance_km double precision)
language sql stable set search_path = public, extensions, pg_temp as $$
  select p.user_id,
         round((st_distance(p.current_location, b.location) / 1000)::numeric, 2)::double precision
  from bookings b
  join services s on s.id = b.service_id
  join provider_profiles p on p.is_online and p.kyc_status = 'approved' and p.current_location is not null
  join users u on u.id = p.user_id and u.is_active and u.deleted_at is null
  where b.id = p_booking_id
    and p.user_id <> b.customer_id
    and st_dwithin(p.current_location, b.location, p_radius_km * 1000)
    and exists (select 1 from provider_categories pc where pc.provider_id = p.user_id and pc.category_id = s.category_id)
    and not exists (
      select 1 from bookings other
      where other.provider_id = p.user_id and other.status in ('assigned', 'en_route', 'arrived', 'in_progress')
    )
    and not exists (select 1 from booking_offers bo where bo.booking_id = b.id and bo.provider_id = p.user_id)
  order by (p.user_id = b.preferred_provider_id) desc,
           st_distance(p.current_location, b.location) asc,
           coalesce(p.rating_avg, 0) desc
  limit least(greatest(p_limit, 1), 20)
$$;

-- -----------------------------------------------------------------------------
-- RPC: accept an offer atomically (first valid accept wins; no double booking)
-- -----------------------------------------------------------------------------
create or replace function accept_booking_offer(p_offer_id uuid, p_provider_id text)
returns bookings
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_offer booking_offers;
  v_booking bookings;
begin
  select * into v_offer from booking_offers where id = p_offer_id for update;
  if not found or v_offer.provider_id <> p_provider_id then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  if v_offer.status <> 'offered' or v_offer.expires_at < now() then
    raise exception 'Offer is no longer available' using errcode = 'P0001';
  end if;

  select * into v_booking from bookings where id = v_offer.booking_id for update;
  if v_booking.status <> 'searching' then
    raise exception 'Booking is no longer searching' using errcode = 'P0001';
  end if;

  -- Lock the partner row so two accepts by the same partner serialise.
  perform 1 from provider_profiles where user_id = p_provider_id for update;
  if not exists (
    select 1 from provider_profiles where user_id = p_provider_id and kyc_status = 'approved' and is_online
  ) then
    raise exception 'Partner must be online and approved' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from bookings where provider_id = p_provider_id and status in ('assigned', 'en_route', 'arrived', 'in_progress')
  ) then
    raise exception 'Partner already has an active job' using errcode = 'P0001';
  end if;

  update booking_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update booking_offers set status = 'cancelled', responded_at = now()
   where booking_id = v_booking.id and id <> p_offer_id and status = 'offered';

  perform set_config('serwish.actor_id', p_provider_id, true);
  perform set_config('serwish.actor_role', 'provider', true);
  update bookings set status = 'assigned', provider_id = p_provider_id where id = v_booking.id
  returning * into v_booking;
  return v_booking;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: provider location ping (throttling happens in the API layer)
-- -----------------------------------------------------------------------------
create or replace function set_provider_location(p_provider_id text, p_lat double precision, p_lng double precision)
returns void language sql set search_path = public, extensions, pg_temp as $$
  update provider_profiles
     set current_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
         location_updated_at = now(),
         last_seen_at = now()
   where user_id = p_provider_id;
$$;

-- -----------------------------------------------------------------------------
-- Lock down: RLS on everywhere, no grants to client roles (audit BE-X2).
-- The backend uses the service role, which bypasses RLS.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke execute on all functions in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke execute on all functions in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from authenticated';
  end if;
end $$;

revoke execute on all functions in schema public from public;

-- RLS is enabled (not forced): the migration owner and Supabase's service_role
-- (BYPASSRLS) keep working. Grant the service role what the API needs.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant usage on schema extensions to service_role';
    execute 'grant all on all tables in schema public to service_role';
    execute 'grant all on all sequences in schema public to service_role';
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Storage: private bucket for KYC documents (Supabase only)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('kyc', 'kyc', false)
    on conflict (id) do update set public = false;
  end if;
end $$;

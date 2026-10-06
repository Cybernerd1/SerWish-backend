-- =============================================================================
-- SerWish v2 - Partner verification (KYC)
--
-- Flow: consent -> identity (DigiLocker or another ID) -> selfie -> bank account
-- -> optional skill certificate -> submit (kyc_status = 'pending') -> admin
-- decision (approved | rejected).
--
-- Privacy rules (see "SerWish Partners - Implementation Plan & DigiLocker KYC"):
--   * never store a full Aadhaar number, the Aadhaar XML or a card image from DigiLocker
--   * keep only the last 4 digits, verified fields, and salted hashes for duplicate checks
--   * document photos live in the private 'kyc' bucket and are referenced by path only
-- =============================================================================

-- New partner state between "not started" and "submitted". Postgres adds enum
-- values outside the migration's transaction scope, so nothing below uses it
-- except plpgsql bodies (checked at call time).
alter type kyc_status add value if not exists 'in_progress' after 'not_started';

create type kyc_step_state as enum ('todo', 'pending', 'done', 'review', 'failed');

-- The upload-based rule from the baseline no longer fits (DigiLocker has no photos).
alter table provider_profiles drop constraint if exists kyc_submission_has_docs;

-- -----------------------------------------------------------------------------
-- One row per partner with the state of every verification step.
-- -----------------------------------------------------------------------------
create table partner_kyc (
  partner_id            text primary key references provider_profiles (user_id) on delete cascade,

  consent_version       text check (char_length(consent_version) <= 40),
  consent_at            timestamptz,
  consent_ip            inet,

  -- Identity
  id_state              kyc_step_state not null default 'todo',
  id_source             text check (id_source in ('digilocker', 'manual')),
  id_doc_type           text check (id_doc_type in ('aadhaar', 'pan', 'driving_licence', 'voter_id', 'passport')),
  id_name               text check (char_length(id_name) <= 120),
  id_dob                date,
  id_gender             text check (id_gender in ('M', 'F', 'T', 'O')),
  id_city               text check (char_length(id_city) <= 80),
  id_state_name         text check (char_length(id_state_name) <= 80),
  id_pincode            text check (id_pincode ~ '^[0-9]{6}$'),
  id_aadhaar_last4      text check (id_aadhaar_last4 ~ '^[0-9]{4}$'),
  id_hash               text check (char_length(id_hash) = 64),   -- HMAC-SHA256 of the document number
  id_photo_path         text,   -- face photo from the ID (for face match), private bucket
  id_front_path         text,   -- manual upload
  id_back_path          text,
  id_reason             text check (char_length(id_reason) <= 300),
  id_verified_at        timestamptz,

  -- Selfie
  selfie_state          kyc_step_state not null default 'todo',
  selfie_path           text,
  selfie_score          numeric(5, 4) check (selfie_score between 0 and 1),
  selfie_liveness       boolean,
  selfie_attempts       int not null default 0 check (selfie_attempts between 0 and 20),
  selfie_reason         text check (char_length(selfie_reason) <= 300),
  selfie_verified_at    timestamptz,

  -- Bank account (full number never stored)
  bank_state            kyc_step_state not null default 'todo',
  bank_holder_name      text check (char_length(bank_holder_name) <= 120),
  bank_name_at_bank     text check (char_length(bank_name_at_bank) <= 120),
  bank_name_score       numeric(5, 2) check (bank_name_score between 0 and 100),
  bank_account_last4    text check (bank_account_last4 ~ '^[0-9]{4}$'),
  bank_account_hash     text check (char_length(bank_account_hash) = 64),
  bank_ifsc             text check (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_attempts         int not null default 0 check (bank_attempts between 0 and 50),
  bank_reason           text check (char_length(bank_reason) <= 300),
  bank_verified_at      timestamptz,

  -- Skill certificate
  cert_state            kyc_step_state not null default 'todo',
  cert_path             text,
  cert_reason           text check (char_length(cert_reason) <= 300),

  -- Review
  flags                 text[] not null default '{}',
  rejection_reasons     text[] not null default '{}',
  rejection_note        text check (char_length(rejection_note) <= 1000),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- One identity document per partner account (catches duplicate accounts).
create unique index partner_kyc_id_hash_uq on partner_kyc (id_hash) where id_hash is not null;
create index partner_kyc_bank_hash_idx on partner_kyc (bank_account_hash) where bank_account_hash is not null;
create trigger partner_kyc_updated_at before update on partner_kyc for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- DigiLocker requests (one per attempt). provider_ref is our verification_id at the provider.
-- -----------------------------------------------------------------------------
create table kyc_digilocker_sessions (
  id            uuid primary key default gen_random_uuid(),
  partner_id    text not null references provider_profiles (user_id) on delete cascade,
  provider      text not null check (provider in ('cashfree', 'fake')),
  provider_ref  text not null check (provider_ref ~ '^[A-Za-z0-9._-]{1,50}$'),
  status        text not null default 'pending'
                check (status in ('pending', 'authenticated', 'completed', 'denied', 'expired', 'failed')),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create unique index kyc_digilocker_ref_uq on kyc_digilocker_sessions (provider, provider_ref);
create index kyc_digilocker_partner_idx on kyc_digilocker_sessions (partner_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Append-only history: every check, upload, submission and admin decision.
-- Never holds document numbers or images, only outcomes.
-- -----------------------------------------------------------------------------
create table kyc_events (
  id          bigint generated always as identity primary key,
  partner_id  text not null references provider_profiles (user_id) on delete cascade,
  actor_id    text references users (id),          -- null = the system / provider callback
  kind        text not null check (kind ~ '^[a-z_.]{3,40}$'),
  result      text check (result in ('ok', 'failed', 'review', 'pending', 'info')),
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index kyc_events_partner_idx on kyc_events (partner_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Admin decision, atomic: profile status + step states + history in one go.
--   p_failed_steps: steps the partner must redo when rejecting
--                   ('identity', 'selfie', 'bank', 'certificate').
-- -----------------------------------------------------------------------------
create or replace function kyc_decide(
  p_partner_id   text,
  p_admin_id     text,
  p_approve      boolean,
  p_reasons      text[] default '{}',
  p_note         text default null,
  p_failed_steps text[] default '{}'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status kyc_status;
begin
  select kyc_status into v_status from provider_profiles where user_id = p_partner_id for update;
  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Partner not found';
  end if;
  if v_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Only a submitted verification can be decided';
  end if;
  if not p_approve and coalesce(array_length(p_reasons, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'Give at least one reason when rejecting';
  end if;

  if p_approve then
    update partner_kyc set
      id_state = case when id_state = 'review' then 'done'::kyc_step_state else id_state end,
      id_verified_at = coalesce(id_verified_at, now()),
      selfie_state = case when selfie_state = 'review' then 'done'::kyc_step_state else selfie_state end,
      selfie_verified_at = coalesce(selfie_verified_at, now()),
      bank_state = case when bank_state = 'review' then 'done'::kyc_step_state else bank_state end,
      bank_verified_at = coalesce(bank_verified_at, now()),
      cert_state = case when cert_state = 'review' then 'done'::kyc_step_state else cert_state end,
      rejection_reasons = '{}', rejection_note = null
    where partner_id = p_partner_id;
    update provider_profiles set
      kyc_status = 'approved', kyc_reviewed_at = now(), kyc_reviewed_by = p_admin_id, kyc_rejection_reason = null
    where user_id = p_partner_id;
  else
    update partner_kyc set
      id_state = case when 'identity' = any (p_failed_steps) then 'failed'::kyc_step_state else id_state end,
      id_reason = case when 'identity' = any (p_failed_steps) then p_reasons[1] else id_reason end,
      selfie_state = case when 'selfie' = any (p_failed_steps) then 'failed'::kyc_step_state else selfie_state end,
      selfie_reason = case when 'selfie' = any (p_failed_steps) then p_reasons[1] else selfie_reason end,
      selfie_attempts = case when 'selfie' = any (p_failed_steps) then 0 else selfie_attempts end,
      bank_state = case when 'bank' = any (p_failed_steps) then 'failed'::kyc_step_state else bank_state end,
      bank_reason = case when 'bank' = any (p_failed_steps) then p_reasons[1] else bank_reason end,
      cert_state = case when 'certificate' = any (p_failed_steps) then 'failed'::kyc_step_state else cert_state end,
      cert_reason = case when 'certificate' = any (p_failed_steps) then p_reasons[1] else cert_reason end,
      rejection_reasons = p_reasons, rejection_note = p_note
    where partner_id = p_partner_id;
    update provider_profiles set
      kyc_status = 'rejected', kyc_reviewed_at = now(), kyc_reviewed_by = p_admin_id,
      kyc_rejection_reason = left(array_to_string(p_reasons, '; '), 500)
    where user_id = p_partner_id;
  end if;

  insert into kyc_events (partner_id, actor_id, kind, result, detail)
  values (
    p_partner_id, p_admin_id, 'admin.decision', case when p_approve then 'ok' else 'failed' end,
    jsonb_build_object('reasons', p_reasons, 'note', p_note, 'failedSteps', p_failed_steps)
  );
end $$;

-- -----------------------------------------------------------------------------
-- Same lock-down as the baseline: RLS on, nothing for client roles, the API's
-- service role gets what it needs.
-- -----------------------------------------------------------------------------
alter table partner_kyc enable row level security;
alter table kyc_digilocker_sessions enable row level security;
alter table kyc_events enable row level security;

revoke execute on function kyc_decide(text, text, boolean, text[], text, text[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on partner_kyc, kyc_digilocker_sessions, kyc_events from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on partner_kyc, kyc_digilocker_sessions, kyc_events from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on partner_kyc, kyc_digilocker_sessions, kyc_events to service_role';
    execute 'grant execute on function kyc_decide(text, text, boolean, text[], text, text[]) to service_role';
  end if;
end $$;

-- History is append-only, even for the API.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke update, delete, truncate on kyc_events from service_role';
  end if;
end $$;

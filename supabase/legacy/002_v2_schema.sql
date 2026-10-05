-- ================================================
-- SerWish v2 Schema Migration
-- Run AFTER 001_initial_schema.sql
-- Aligns database with serwishbackend controllers
-- ================================================

-- ============================================================
-- DROP old tables that are being replaced
-- ============================================================
DROP TABLE IF EXISTS booking_provider_responses CASCADE;
DROP TABLE IF EXISTS provider_services CASCADE;
DROP TABLE IF EXISTS provider_profiles CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;

-- ============================================================
-- Add missing columns to existing tables
-- ============================================================

-- Seekers: add missing columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS default_address_id UUID,
  ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3,2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS total_bookings INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(10,2) DEFAULT 0.00;

-- Migrate existing full_name → name
UPDATE users SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;

-- ============================================================
-- Providers table (new, separate from users)
-- ============================================================
CREATE TABLE IF NOT EXISTS providers (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone                   TEXT UNIQUE,
  email                   TEXT UNIQUE,
  name                    TEXT,
  profile_photo_url       TEXT,
  bio                     TEXT,
  skills                  JSONB DEFAULT '[]'::JSONB,
  current_location        GEOMETRY(POINT, 4326),
  is_online               BOOLEAN DEFAULT FALSE,
  rating_avg              NUMERIC(3, 2) DEFAULT 5.00,
  total_jobs              INT DEFAULT 0,
  response_time_minutes   INT DEFAULT 5,
  kyc_status              TEXT DEFAULT 'pending' CHECK (kyc_status IN ('pending','verified','rejected')),
  kyc_aadhaar_front_url   TEXT,
  kyc_aadhaar_back_url    TEXT,
  kyc_selfie_url          TEXT,
  kyc_certificate_url     TEXT,
  kyc_submitted_at        TIMESTAMPTZ,
  wallet_balance          NUMERIC(10, 2) DEFAULT 0.00,
  bank_account            JSONB,
  fcm_token               TEXT,
  last_seen_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_location ON providers USING GIST(current_location);
CREATE INDEX IF NOT EXISTS idx_providers_online ON providers(is_online);

-- ============================================================
-- Service Categories (replaces services table)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  icon_url      TEXT,
  description   TEXT,
  base_price    NUMERIC(10, 2) NOT NULL DEFAULT 200.00,
  display_order INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO service_categories (name, slug, description, base_price, display_order) VALUES
  ('Electrician',   'electrician',  'Wiring, repairs, new installations', 299.00, 1),
  ('Plumber',       'plumber',      'Leaks, pipes, bathroom fixtures',     249.00, 2),
  ('Cleaner',       'cleaner',      'Deep cleaning, regular housekeeping', 399.00, 3),
  ('Carpenter',     'carpenter',    'Furniture repair, custom woodwork',   349.00, 4),
  ('Painter',       'painter',      'Interior, exterior, waterproofing',   499.00, 5),
  ('AC Repair',     'ac-repair',    'Servicing, gas refill, installation', 599.00, 6),
  ('Beauty',        'beauty',       'Haircut, facial, waxing at home',     299.00, 7),
  ('Pest Control',  'pest-control', 'Cockroach, termite, rodent control',  799.00, 8)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Addresses table
-- ============================================================
CREATE TABLE IF NOT EXISTS addresses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  full_address  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Update Bookings table to match new schema
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS seeker_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS service_category_id UUID REFERENCES service_categories(id),
  ADD COLUMN IF NOT EXISTS address_id UUID REFERENCES addresses(id),
  ADD COLUMN IF NOT EXISTS otp VARCHAR(4),
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS cancel_fee NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quoted_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS final_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- ============================================================
-- Reviews table (replaces ratings)
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL UNIQUE REFERENCES bookings(id),
  seeker_id   UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES providers(id),
  rating      NUMERIC(2, 1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT,
  tags        TEXT[] DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);

-- ============================================================
-- Messages (chat)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('seeker', 'provider')),
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id);

-- ============================================================
-- Payment Methods
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN ('card', 'upi', 'wallet')),
  label               TEXT,
  masked_details      TEXT,
  razorpay_token_id   TEXT,
  is_default          BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Wallet Transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL,
  user_type             TEXT NOT NULL CHECK (user_type IN ('seeker', 'provider')),
  amount                NUMERIC(10, 2) NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'withdrawal')),
  status                TEXT DEFAULT 'pending',
  description           TEXT,
  booking_id            UUID REFERENCES bookings(id),
  razorpay_payment_id   TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Portfolio Photos
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_photos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RPC Functions (updated for new schema)
-- ============================================================

-- Find nearby online verified providers
CREATE OR REPLACE FUNCTION nearby_providers(
  user_lat FLOAT,
  user_lng FLOAT,
  radius_km FLOAT DEFAULT 3,
  category_slug TEXT DEFAULT NULL,
  sort_by TEXT DEFAULT 'distance',
  page_offset INT DEFAULT 0,
  page_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID, name TEXT, profile_photo_url TEXT, bio TEXT,
  rating_avg NUMERIC, total_jobs INT, skills JSONB,
  kyc_status TEXT, distance_km FLOAT, response_time_minutes INT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.profile_photo_url, p.bio,
    p.rating_avg, p.total_jobs, p.skills, p.kyc_status,
    ROUND((ST_Distance(
      p.current_location::geography,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) / 1000)::numeric, 2)::float AS distance_km,
    p.response_time_minutes
  FROM providers p
  WHERE
    p.is_online = TRUE
    AND p.kyc_status = 'verified'
    AND p.current_location IS NOT NULL
    AND ST_DWithin(
      p.current_location::geography,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_km * 1000
    )
  ORDER BY
    CASE WHEN sort_by = 'rating' THEN p.rating_avg END DESC NULLS LAST,
    CASE WHEN sort_by = 'distance' THEN
      ST_Distance(p.current_location::geography, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography)
    END ASC NULLS LAST
  LIMIT page_limit OFFSET page_offset;
END;
$$;

-- Find providers for job broadcast
CREATE OR REPLACE FUNCTION nearby_providers_for_job(
  job_lat FLOAT,
  job_lng FLOAT,
  radius_km FLOAT DEFAULT 3,
  category_id UUID DEFAULT NULL
)
RETURNS TABLE (id UUID, fcm_token TEXT, distance_m FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.fcm_token,
    ST_Distance(
      p.current_location::geography,
      ST_SetSRID(ST_MakePoint(job_lng, job_lat), 4326)::geography
    )::float AS distance_m
  FROM providers p
  WHERE
    p.is_online = TRUE
    AND p.kyc_status = 'verified'
    AND p.current_location IS NOT NULL
    AND ST_DWithin(
      p.current_location::geography,
      ST_SetSRID(ST_MakePoint(job_lng, job_lat), 4326)::geography,
      radius_km * 1000
    )
  ORDER BY distance_m ASC;
END;
$$;

-- Update provider rating after review
CREATE OR REPLACE FUNCTION update_provider_rating(provider_uuid UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE providers
  SET
    rating_avg = (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE provider_id = provider_uuid),
    total_jobs = (SELECT COUNT(*) FROM bookings WHERE provider_id = provider_uuid AND status = 'completed'),
    updated_at = NOW()
  WHERE id = provider_uuid;
END;
$$;

-- Credit provider wallet after job completion
CREATE OR REPLACE FUNCTION credit_wallet(
  provider_uuid UUID,
  amount NUMERIC,
  booking_uuid UUID
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE providers SET wallet_balance = wallet_balance + amount, updated_at = NOW()
  WHERE id = provider_uuid;

  INSERT INTO wallet_transactions(user_id, user_type, amount, type, status, description, booking_id)
  VALUES (provider_uuid, 'provider', amount, 'credit', 'completed',
    'Earnings from booking ' || booking_uuid, booking_uuid);
END;
$$;

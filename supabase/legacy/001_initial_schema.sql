-- ============================================================
-- SerWish Database Schema
-- Run this in Supabase SQL Editor
-- Requires: PostGIS extension (enable in Supabase dashboard first)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('user', 'provider', 'admin');

CREATE TYPE booking_status AS ENUM (
  'broadcast',     -- sent to nearby providers, waiting for accepts
  'accepted',      -- user confirmed a specific provider
  'ongoing',       -- provider has started the job
  'completed',     -- job done
  'cancelled',     -- cancelled by user or provider
  'no_providers'   -- no providers found in area
);

CREATE TYPE response_status AS ENUM ('notified', 'accepted', 'rejected', 'expired');

CREATE TYPE cancelled_by AS ENUM ('user', 'provider', 'system');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  full_name     TEXT,
  avatar_url    TEXT,
  role          user_role NOT NULL DEFAULT 'user',
  fcm_token     TEXT,       -- Firebase Cloud Messaging device token
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for FCM token lookups
CREATE INDEX idx_users_fcm_token ON users(fcm_token) WHERE fcm_token IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- SERVICES CATALOGUE
-- ============================================================

CREATE TABLE services (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,           -- e.g. 'Plumbing', 'Cleaning', 'Electrical'
  base_price  NUMERIC(10,2) NOT NULL,  -- base price in INR
  icon_url    TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_category ON services(category);
CREATE INDEX idx_services_active ON services(is_active);

-- ============================================================
-- PROVIDER PROFILES
-- ============================================================

CREATE TABLE provider_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio               TEXT,
  experience_years  INT DEFAULT 0,
  avg_rating        NUMERIC(3,2) DEFAULT 0.00,
  total_jobs        INT DEFAULT 0,
  is_available      BOOLEAN NOT NULL DEFAULT FALSE,
  -- PostGIS geography point — longitude, latitude order (GeoJSON convention)
  location          GEOGRAPHY(Point, 4326),
  location_updated_at TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index — critical for fast geo queries
CREATE INDEX idx_provider_location ON provider_profiles USING GIST(location);
CREATE INDEX idx_provider_available ON provider_profiles(is_available) WHERE is_available = TRUE;

-- ============================================================
-- PROVIDER → SERVICES MAPPING
-- ============================================================

CREATE TABLE provider_services (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, service_id)
);

CREATE INDEX idx_provider_services_provider ON provider_services(provider_id);
CREATE INDEX idx_provider_services_service ON provider_services(service_id);

-- ============================================================
-- BOOKINGS
-- ============================================================

CREATE TABLE bookings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  provider_id   UUID REFERENCES users(id),   -- null until user selects a provider
  service_id    UUID NOT NULL REFERENCES services(id),

  -- Location of the job
  latitude      NUMERIC(10,7) NOT NULL,
  longitude     NUMERIC(10,7) NOT NULL,
  address       TEXT NOT NULL,
  description   TEXT,

  status        booking_status NOT NULL DEFAULT 'broadcast',
  base_price    NUMERIC(10,2),
  final_price   NUMERIC(10,2),            -- set on completion (future: surge pricing)
  scheduled_at  TIMESTAMPTZ,             -- null = instant booking

  -- Timestamps for each state transition
  accepted_at   TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  cancelled_by  cancelled_by,
  cancel_reason TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_provider ON bookings(provider_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);

-- ============================================================
-- BOOKING PROVIDER RESPONSES
-- Tracks which providers were notified and who accepted
-- ============================================================

CREATE TABLE booking_provider_responses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id  UUID NOT NULL REFERENCES users(id),
  status       response_status NOT NULL DEFAULT 'notified',
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(booking_id, provider_id)
);

CREATE INDEX idx_bpr_booking ON booking_provider_responses(booking_id);
CREATE INDEX idx_bpr_provider ON booking_provider_responses(provider_id);
CREATE INDEX idx_bpr_status ON booking_provider_responses(status);

-- ============================================================
-- RATINGS
-- ============================================================

CREATE TABLE ratings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id   UUID NOT NULL UNIQUE REFERENCES bookings(id),  -- one rating per booking
  user_id      UUID NOT NULL REFERENCES users(id),
  provider_id  UUID NOT NULL REFERENCES users(id),
  rating       INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ratings_provider ON ratings(provider_id);

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- 1. Find nearby available providers for a given service and location
--    Called by matching engine on every booking creation
CREATE OR REPLACE FUNCTION find_nearby_providers(
  p_service_id  UUID,
  p_lat         FLOAT,
  p_lng         FLOAT,
  p_radius_m    FLOAT DEFAULT 10000  -- 10km default
)
RETURNS TABLE (
  user_id       UUID,
  full_name     TEXT,
  avg_rating    NUMERIC,
  total_jobs    INT,
  distance_m    FLOAT,
  fcm_token     TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.user_id,
    u.full_name,
    pp.avg_rating,
    pp.total_jobs,
    ST_Distance(
      pp.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_m,
    u.fcm_token
  FROM provider_profiles pp
  JOIN users u ON u.id = pp.user_id
  -- If a service_id is provided, filter to providers offering that service
  JOIN provider_services ps ON ps.provider_id = pp.user_id
    AND (p_service_id IS NULL OR ps.service_id = p_service_id)
  WHERE
    pp.is_available = TRUE
    AND u.is_active = TRUE
    AND pp.location IS NOT NULL
    AND ST_DWithin(
      pp.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY distance_m ASC
  LIMIT 20;  -- max 20 providers notified per booking
END;
$$;

-- 2. Update provider location (called from HTTP and Socket)
CREATE OR REPLACE FUNCTION update_provider_location(
  p_user_id  UUID,
  p_lat      FLOAT,
  p_lng      FLOAT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE provider_profiles
  SET
    location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    location_updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- 3. Recompute provider average rating after a new rating is submitted
CREATE OR REPLACE FUNCTION update_provider_avg_rating(p_provider_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE provider_profiles
  SET avg_rating = (
    SELECT COALESCE(AVG(rating), 0)
    FROM ratings
    WHERE provider_id = p_provider_id
  )
  WHERE user_id = p_provider_id;
END;
$$;

-- 4. Increment total_jobs counter for a provider
CREATE OR REPLACE FUNCTION increment_provider_jobs(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE provider_profiles
  SET total_jobs = total_jobs + 1
  WHERE user_id = p_user_id;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_provider_responses ENABLE ROW LEVEL SECURITY;

-- Users: only see/edit own row
CREATE POLICY "users_own" ON users
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Bookings: user sees their own, provider sees their own
CREATE POLICY "bookings_user" ON bookings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "bookings_provider" ON bookings
  FOR SELECT USING (auth.uid() = provider_id);

-- Ratings: user can insert for their own completed bookings; public read
CREATE POLICY "ratings_insert" ON ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ratings_read" ON ratings
  FOR SELECT USING (TRUE);

-- Provider profiles: owner can update, public can read
CREATE POLICY "provider_profile_read" ON provider_profiles
  FOR SELECT USING (TRUE);

CREATE POLICY "provider_profile_write" ON provider_profiles
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- SEED DATA — Service Catalogue
-- ============================================================

INSERT INTO services (name, category, base_price) VALUES
  ('Electrician',        'Electrical',  399),
  ('AC Repair',          'Electrical',  699),
  ('Plumber',            'Plumbing',    399),
  ('Pipe Fitting',       'Plumbing',    299),
  ('Home Cleaning',      'Cleaning',    599),
  ('Deep Clean',         'Cleaning',    999),
  ('Carpenter',          'Carpentry',   499),
  ('Furniture Assembly', 'Carpentry',   299),
  ('Pest Control',       'Pest',        799),
  ('Cook',               'Cooking',     499),
  ('Laundry',            'Laundry',     199),
  ('Painting',           'Painting',    1299);

-- ============================================================
-- TRIGGERS — auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_provider_profiles_updated_at
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

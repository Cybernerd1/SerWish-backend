-- ================================================
-- SerWish v3 Schema Migration
-- Run AFTER 002_v2_schema.sql
-- Fixes Firebase UID compatibility:
--   Firebase UIDs are strings (e.g. "abc123XYZ"), not UUIDs.
--   Changes id columns to TEXT for Firebase compatibility.
-- ================================================

-- ============================================================
-- 1. ALTER users.id from UUID to TEXT
-- ============================================================

-- Drop dependent foreign keys first
ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_user_id_fkey;
ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_user_id_fkey;
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_user_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_user_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_seeker_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_provider_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;

-- Change users.id type
ALTER TABLE users ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE users ALTER COLUMN id SET DEFAULT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE users ADD PRIMARY KEY (id);

-- Change foreign key columns to TEXT
ALTER TABLE addresses ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
ALTER TABLE payment_methods ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
ALTER TABLE wallet_transactions ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
ALTER TABLE bookings ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
ALTER TABLE bookings ALTER COLUMN seeker_id TYPE TEXT USING seeker_id::TEXT;
ALTER TABLE bookings ALTER COLUMN provider_id TYPE TEXT USING provider_id::TEXT;

-- Re-add foreign keys
ALTER TABLE addresses ADD CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE bookings ADD CONSTRAINT bookings_seeker_id_fkey FOREIGN KEY (seeker_id) REFERENCES users(id);

-- ============================================================
-- 2. ALTER providers.id from UUID to TEXT
-- ============================================================
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_provider_id_fkey;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_seeker_id_fkey;
ALTER TABLE portfolio_photos DROP CONSTRAINT IF EXISTS portfolio_photos_provider_id_fkey;

-- Drop the auth.users reference — Firebase manages users, not Supabase Auth
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_pkey;
ALTER TABLE providers ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE providers ADD PRIMARY KEY (id);

-- Update reviews columns
ALTER TABLE reviews ALTER COLUMN seeker_id TYPE TEXT USING seeker_id::TEXT;
ALTER TABLE reviews ALTER COLUMN provider_id TYPE TEXT USING provider_id::TEXT;

-- Update portfolio_photos
ALTER TABLE portfolio_photos ALTER COLUMN provider_id TYPE TEXT USING provider_id::TEXT;

-- Re-add foreign keys for reviews and portfolio
ALTER TABLE reviews ADD CONSTRAINT reviews_seeker_id_fkey FOREIGN KEY (seeker_id) REFERENCES users(id);
ALTER TABLE reviews ADD CONSTRAINT reviews_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE portfolio_photos ADD CONSTRAINT portfolio_photos_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;

-- Bookings → providers FK
ALTER TABLE bookings ADD CONSTRAINT bookings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);

-- ============================================================
-- 3. Disable RLS for service account access
-- The backend uses supabase service_role_key which bypasses RLS,
-- but explicitly disable old policies that reference auth.uid()
-- since we're using Firebase Auth, not Supabase Auth.
-- ============================================================
DROP POLICY IF EXISTS "users_own" ON users;
DROP POLICY IF EXISTS "bookings_user" ON bookings;
DROP POLICY IF EXISTS "bookings_provider" ON bookings;
DROP POLICY IF EXISTS "ratings_insert" ON ratings;
DROP POLICY IF EXISTS "ratings_read" ON ratings;
DROP POLICY IF EXISTS "provider_profile_read" ON provider_profiles;
DROP POLICY IF EXISTS "provider_profile_write" ON provider_profiles;

-- Allow full access via service_role (backend)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE providers DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;
ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE addresses DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_photos DISABLE ROW LEVEL SECURITY;

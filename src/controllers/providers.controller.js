import { supabaseAdmin } from '../config/supabase.js';
import { success, error, notFound } from '../utils/response.js';
import { logger } from '../utils/logger.js';
// FIX BUG-030: Import PLATFORM_FEE_PERCENT from constants instead of hardcoding 0.15
import { PROVIDER_SEARCH_RADIUS_KM, DEFAULT_PAGE_SIZE, PLATFORM_FEE_PERCENT } from '../config/constants.js';

/**
 * GET /api/v1/providers
 * PostGIS ST_DWithin query for nearby available providers.
 * Query params: lat, lng, category, radius (km), sort, page, limit
 */
export const getNearbyProviders = async (req, res, next) => {
  try {
    const {
      lat,
      lng,
      category,
      radius = PROVIDER_SEARCH_RADIUS_KM,
      sort = 'distance',
      page = 1,
      limit = DEFAULT_PAGE_SIZE,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // Use PostGIS RPC function for geo query
    // The function `nearby_providers` must be created in Supabase
    const { data, error: dbError } = await supabaseAdmin.rpc('nearby_providers', {
      user_lat: parseFloat(lat),
      user_lng: parseFloat(lng),
      radius_km: parseFloat(radius),
      category_slug: category || null,
      sort_by: sort,
      page_offset: offset,
      page_limit: parseInt(limit),
    });

    if (dbError) {
      logger.error(`nearby_providers RPC error: ${dbError.message}`);
      return error(res, 'Failed to fetch providers', 500);
    }

    return success(res, data || []);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/providers/:id
 */
export const getProviderById = async (req, res, next) => {
  try {
    const { data: provider, error: dbError } = await supabaseAdmin
      .from('providers')
      .select(`
        id, name, profile_photo_url, bio, rating_avg, total_jobs, kyc_status,
        skills, response_time_minutes, is_online,
        provider_reviews:reviews(
          id, rating, comment, tags, created_at,
          seeker:users(id, name, profile_photo_url)
        ),
        portfolio_photos(id, url, created_at)
      `)
      .eq('id', req.params.id)
      .order('created_at', { referencedTable: 'reviews', ascending: false })
      .limit(5, { referencedTable: 'reviews' })
      .single();

    if (dbError || !provider) return notFound(res, 'Provider not found');

    return success(res, provider);
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/providers/profile
 */
export const updateProviderProfile = async (req, res, next) => {
  try {
    const { name, bio, profilePhotoUrl, fcmToken } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (bio !== undefined) updates.bio = bio;
    if (profilePhotoUrl !== undefined) updates.profile_photo_url = profilePhotoUrl;
    if (fcmToken !== undefined) updates.fcm_token = fcmToken;
    updates.updated_at = new Date().toISOString();

    const { data, error: dbError } = await supabaseAdmin
      .from('providers')
      .update(updates)
      .eq('id', req.userId)
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, data, 'Profile updated');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/providers/skills
 */
export const setProviderSkills = async (req, res, next) => {
  try {
    const { skills } = req.body; // [{ categoryId, tags[], experienceLevel }]

    if (!Array.isArray(skills) || skills.length === 0) {
      return error(res, 'At least one skill is required', 400);
    }

    const { data, error: dbError } = await supabaseAdmin
      .from('providers')
      .update({ skills, updated_at: new Date().toISOString() })
      .eq('id', req.userId)
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, data, 'Skills updated');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/providers/kyc
 * Accepts file URLs (uploaded to Supabase Storage from the app directly).
 *
 * SEC-007: Validate that the provided URLs belong to our Supabase Storage
 * bucket before writing them to the database.
 */
export const uploadKyc = async (req, res, next) => {
  try {
    const { aadhaarFrontUrl, aadhaarBackUrl, selfieUrl, certificateUrl } = req.body;

    // SEC-007: Validate that all URLs come from our own Supabase Storage bucket
    // to prevent SSRF or injection of arbitrary external URLs.
    const allowedStorageBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/`;
    const urlsToValidate = [aadhaarFrontUrl, aadhaarBackUrl, selfieUrl, certificateUrl].filter(Boolean);

    for (const url of urlsToValidate) {
      if (!url.startsWith(allowedStorageBase)) {
        return error(res, 'Invalid document URL. Files must be uploaded to SerWish storage.', 400);
      }
    }

    const { data, error: dbError } = await supabaseAdmin
      .from('providers')
      .update({
        kyc_aadhaar_front_url: aadhaarFrontUrl,
        kyc_aadhaar_back_url: aadhaarBackUrl,
        kyc_selfie_url: selfieUrl,
        kyc_certificate_url: certificateUrl,
        kyc_status: 'pending',
        kyc_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.userId)
      .select('id, kyc_status')
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, data, 'KYC documents submitted. Verification typically takes 24 hours.');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/providers/earnings
 */
export const getEarnings = async (req, res, next) => {
  try {
    const { period = 'week' } = req.query;

    const periodDays = period === 'month' ? 30 : 7;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: bookings, error: dbError } = await supabaseAdmin
      .from('bookings')
      .select('id, final_price, end_time, status, created_at')
      .eq('provider_id', req.userId)
      .eq('status', 'completed')
      .gte('end_time', since)
      .order('end_time', { ascending: true });

    if (dbError) return error(res, dbError.message, 400);

    const totalGross = bookings?.reduce((sum, b) => sum + (b.final_price || 0), 0) || 0;
    // FIX BUG-030: Use PLATFORM_FEE_PERCENT from constants instead of hardcoded 0.15
    const totalNet = totalGross * (1 - PLATFORM_FEE_PERCENT / 100);

    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('wallet_balance')
      .eq('id', req.userId)
      .single();

    return success(res, {
      period,
      totalGross,
      totalNet,
      jobCount: bookings?.length || 0,
      walletBalance: provider?.wallet_balance || 0,
      jobs: bookings || [],
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/providers/withdraw
 *
 * FIX BUG-004: The withdrawal is now handled by an atomic Supabase RPC
 * `request_withdrawal` that performs the balance check, transaction insert,
 * and balance deduction in a single database transaction with a row-level lock,
 * preventing the double-spend race condition.
 *
 * The RPC must implement:
 *   BEGIN;
 *   SELECT wallet_balance FROM providers WHERE id = p_provider_id FOR UPDATE;
 *   IF wallet_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
 *   INSERT INTO wallet_transactions (...) VALUES (...);
 *   UPDATE providers SET wallet_balance = wallet_balance - p_amount WHERE id = p_provider_id;
 *   COMMIT;
 */
export const requestWithdrawal = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const { MIN_WITHDRAWAL_INR } = await import('../config/constants.js');

    if (!amount || amount < MIN_WITHDRAWAL_INR) {
      return error(res, `Minimum withdrawal is Rs. ${MIN_WITHDRAWAL_INR}`, 400);
    }

    // FIX BUG-004: Use atomic RPC to prevent race conditions / double-spend
    const { data: withdrawal, error: rpcError } = await supabaseAdmin.rpc('request_withdrawal', {
      p_provider_id: req.userId,
      p_amount: amount,
    });

    if (rpcError) {
      // The RPC raises an exception on insufficient balance
      return error(res, rpcError.message || 'Withdrawal failed', 400);
    }

    return success(res, withdrawal, 'Withdrawal request submitted. Processing in 1-2 business days.');
  } catch (err) {
    next(err);
  }
};

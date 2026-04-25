import { supabaseAdmin } from '../config/supabase.js';
import { success, error, notFound } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * GET /api/v1/users/me
 */
export const getMe = async (req, res, next) => {
  try {
    const { data: user, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, phone, email, name, profile_photo_url, rating_avg, total_bookings, wallet_balance, created_at')
      .eq('id', req.userId)
      .single();

    if (dbError || !user) return notFound(res, 'User not found');

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/users/profile
 */
export const updateProfile = async (req, res, next) => {
  try {
    const { name, profilePhotoUrl, fcmToken } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (profilePhotoUrl !== undefined) updates.profile_photo_url = profilePhotoUrl;
    if (fcmToken !== undefined) updates.fcm_token = fcmToken;
    updates.updated_at = new Date().toISOString();

    const { data: user, error: dbError } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', req.userId)
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, user, 'Profile updated');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/users/addresses
 */
export const getAddresses = async (req, res, next) => {
  try {
    const { data: addresses, error: dbError } = await supabaseAdmin
      .from('addresses')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (dbError) return error(res, dbError.message, 400);

    return success(res, addresses || []);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/users/addresses
 */
export const addAddress = async (req, res, next) => {
  try {
    const { label, lat, lng, fullAddress } = req.body;

    const { data: address, error: dbError } = await supabaseAdmin
      .from('addresses')
      .insert({
        user_id: req.userId,
        label,
        lat,
        lng,
        full_address: fullAddress,
      })
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, address, 'Address saved', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/users/addresses/:id
 * FIX BUG-011: Return 404 if the address does not exist or does not belong to
 * this user. Previously returned 200 even for non-existent IDs.
 */
export const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;

    // First confirm the row exists and belongs to this user
    const { data: existing, error: findError } = await supabaseAdmin
      .from('addresses')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (findError || !existing) return notFound(res, 'Address not found');

    const { error: dbError } = await supabaseAdmin
      .from('addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (dbError) return error(res, dbError.message, 400);

    return success(res, null, 'Address deleted');
  } catch (err) {
    next(err);
  }
};

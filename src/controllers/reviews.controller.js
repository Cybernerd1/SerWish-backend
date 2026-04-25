import { supabaseAdmin } from '../config/supabase.js';
import { success, error, forbidden, notFound } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * POST /api/v1/reviews
 */
export const submitReview = async (req, res, next) => {
  try {
    const { bookingId, rating, comment, tags } = req.body;

    // Verify booking belongs to this seeker and is completed
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, seeker_id, provider_id, status')
      .eq('id', bookingId)
      .single();

    if (!booking) return notFound(res, 'Booking not found');
    if (booking.seeker_id !== req.userId) return forbidden(res, 'Access denied');
    if (booking.status !== 'completed') return error(res, 'Reviews can only be submitted for completed bookings', 400);

    // Check for duplicate review
    const { data: existing } = await supabaseAdmin
      .from('reviews')
      .select('id')
      .eq('booking_id', bookingId)
      .single();

    if (existing) return error(res, 'You have already reviewed this booking', 400);

    // Insert review
    const { data: review, error: dbError } = await supabaseAdmin
      .from('reviews')
      .insert({
        booking_id: bookingId,
        seeker_id: req.userId,
        provider_id: booking.provider_id,
        rating,
        comment: comment || null,
        tags: tags || [],
      })
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    // Update provider's average rating
    await supabaseAdmin.rpc('update_provider_rating', {
      provider_uuid: booking.provider_id,
    });

    logger.info(`Review submitted for provider ${booking.provider_id} — rating: ${rating}`);

    return success(res, review, 'Review submitted. Thank you!', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/reviews?providerId=
 */
export const getReviews = async (req, res, next) => {
  try {
    const { providerId, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('reviews')
      .select(`
        id, rating, comment, tags, created_at,
        seeker:users(id, name, profile_photo_url)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (providerId) query = query.eq('provider_id', providerId);

    const { data, error: dbError } = await query;
    if (dbError) return error(res, dbError.message, 400);

    return success(res, data || []);
  } catch (err) {
    next(err);
  }
};

import { supabaseAdmin } from '../config/supabase.js';
import { success, error, notFound, forbidden } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PLATFORM_FEE_PERCENT,
  FREE_CANCEL_WINDOW_SECONDS,
  CANCEL_FEE_INR,
  PROVIDER_SEARCH_RADIUS_KM,
} from '../config/constants.js';
import { getIO } from '../socket/index.js';
import { broadcastJobToProviders } from '../socket/booking.socket.js';
// FIX BUG-006: Use crypto.randomInt instead of Math.random() for OTP generation
import { randomInt } from 'crypto';
// FIX BUG-005: Import bcryptjs to store a hashed OTP instead of plaintext
import bcrypt from 'bcryptjs';

// In-memory map: bookingId → acceptTimer
// Used to clear the broadcast timer when a provider accepts
const activeTimers = new Map();

/**
 * POST /api/v1/bookings
 * Create a new booking and broadcast to nearby providers.
 */
export const createBooking = async (req, res, next) => {
  try {
    const { serviceCategoryId, addressId, paymentMethod, providerId } = req.body;

    if (!serviceCategoryId || !addressId) {
      return error(res, 'serviceCategoryId and addressId are required', 400);
    }

    // Get seeker address for geo matching
    const { data: address } = await supabaseAdmin
      .from('addresses')
      .select('lat, lng, full_address')
      .eq('id', addressId)
      .eq('user_id', req.userId)
      .single();

    if (!address) return notFound(res, 'Address not found');

    // Get service category for price
    const { data: category } = await supabaseAdmin
      .from('service_categories')
      .select('id, name, base_price')
      .eq('id', serviceCategoryId)
      .single();

    if (!category) return notFound(res, 'Service category not found');

    const platformFee = (category.base_price * PLATFORM_FEE_PERCENT) / 100;
    const quotedPrice = category.base_price + platformFee;

    // Create booking
    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .insert({
        seeker_id: req.userId,
        provider_id: providerId || null,
        service_category_id: serviceCategoryId,
        address_id: addressId,
        status: BOOKING_STATUS.SEARCHING,
        quoted_price: quotedPrice,
        payment_status: PAYMENT_STATUS.PENDING,
        payment_method: paymentMethod || 'cash',
      })
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    // Find nearby online providers via PostGIS
    const { data: nearbyProviders } = await supabaseAdmin.rpc('nearby_providers_for_job', {
      job_lat: address.lat,
      job_lng: address.lng,
      radius_km: PROVIDER_SEARCH_RADIUS_KM,
      category_id: serviceCategoryId,
    });

    const providerIds = (nearbyProviders || []).map((p) => p.id);

    if (providerIds.length > 0) {
      // FIX BUG-007: Guard against Socket.IO not yet initialized
      try {
        const io = getIO();
        const timer = broadcastJobToProviders(io, providerIds, {
          bookingId: booking.id,
          serviceType: category.name,
          serviceCategoryId,
          estimatedPrice: quotedPrice,
          seekerLat: address.lat,
          seekerLng: address.lng,
          seekerRating: 4.5, // TODO: fetch actual seeker rating from DB
        });
        activeTimers.set(booking.id, timer);
      } catch (socketErr) {
        // Socket.IO not initialized — log and continue, booking still created
        logger.warn(`Socket.IO unavailable during booking creation: ${socketErr.message}`);
      }
    }

    logger.info(`Booking ${booking.id} created. Broadcasting to ${providerIds.length} providers.`);

    return success(res, { booking, nearbyProviderCount: providerIds.length }, 'Booking created', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/bookings
 */
export const getBookings = async (req, res, next) => {
  try {
    const { status } = req.query;

    let query = supabaseAdmin
      .from('bookings')
      .select(`
        id, status, quoted_price, final_price, payment_status, created_at, start_time, end_time,
        service_category:service_categories(id, name, icon_url),
        address:addresses(full_address),
        provider:providers(id, name, profile_photo_url, rating_avg),
        seeker:users(id, name, profile_photo_url)
      `)
      .order('created_at', { ascending: false });

    // Show bookings relevant to this user (seeker or provider)
    if (req.role === 'seeker') {
      query = query.eq('seeker_id', req.userId);
    } else {
      query = query.eq('provider_id', req.userId);
    }

    if (status === 'active') {
      query = query.in('status', [
        BOOKING_STATUS.SEARCHING,
        BOOKING_STATUS.MATCHED,
        BOOKING_STATUS.EN_ROUTE,
        BOOKING_STATUS.IN_PROGRESS,
      ]);
    } else if (status === 'past') {
      query = query.in('status', [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED]);
    }

    const { data, error: dbError } = await query;

    if (dbError) return error(res, dbError.message, 400);

    return success(res, data || []);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/bookings/:id
 */
export const getBookingById = async (req, res, next) => {
  try {
    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .select(`
        *,
        service_category:service_categories(*),
        address:addresses(*),
        provider:providers(id, name, profile_photo_url, rating_avg, phone),
        seeker:users(id, name, profile_photo_url, phone)
      `)
      .eq('id', req.params.id)
      .single();

    if (dbError || !booking) return notFound(res, 'Booking not found');

    // Access control
    if (booking.seeker_id !== req.userId && booking.provider_id !== req.userId) {
      return forbidden(res, 'Access denied');
    }

    return success(res, booking);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/bookings/:id
 */
export const cancelBooking = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { id } = req.params;

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('seeker_id, provider_id, status, created_at')
      .eq('id', id)
      .single();

    if (!booking) return notFound(res, 'Booking not found');
    if (booking.seeker_id !== req.userId) return forbidden(res, 'Access denied');
    if ([BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED].includes(booking.status)) {
      return error(res, 'Booking cannot be cancelled in its current state', 400);
    }

    // Check cancellation fee
    const ageSeconds = (Date.now() - new Date(booking.created_at).getTime()) / 1000;
    const cancelFee = ageSeconds > FREE_CANCEL_WINDOW_SECONDS && booking.provider_id
      ? CANCEL_FEE_INR
      : 0;

    const { error: dbError } = await supabaseAdmin
      .from('bookings')
      .update({
        status: BOOKING_STATUS.CANCELLED,
        cancellation_reason: reason || 'Cancelled by seeker',
        cancelled_by: 'seeker',
        cancel_fee: cancelFee,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (dbError) return error(res, dbError.message, 400);

    // Clear broadcast timer if still searching
    if (activeTimers.has(id)) {
      clearTimeout(activeTimers.get(id));
      activeTimers.delete(id);
    }

    // Notify provider if matched
    if (booking.provider_id) {
      try {
        const io = getIO();
        io.to(`user:${booking.provider_id}`).emit('booking_cancelled_seeker', {
          bookingId: id,
          cancelFee,
        });
      } catch (_) { /* Socket may not be available */ }
    }

    return success(res, { cancelFee }, cancelFee > 0
      ? `Booking cancelled. Rs. ${cancelFee} cancellation fee applied.`
      : 'Booking cancelled successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/bookings/:id/accept
 * Atomic first-write-wins. Clears the broadcast timer on success.
 */
export const acceptBooking = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.role !== 'provider') return forbidden(res, 'Only providers can accept bookings');

    // Atomic update — only succeeds if booking is still 'searching'
    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .update({
        provider_id: req.userId,
        status: BOOKING_STATUS.EN_ROUTE,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', BOOKING_STATUS.SEARCHING) // Guard: only accept if still searching
      .select(`
        seeker_id, quoted_price,
        seeker:users(id, name, profile_photo_url, fcm_token)
      `)
      .single();

    if (dbError || !booking) {
      return error(res, 'Booking no longer available (already accepted or cancelled)', 409);
    }

    // Clear the broadcast timer
    if (activeTimers.has(id)) {
      clearTimeout(activeTimers.get(id));
      activeTimers.delete(id);
    }

    // Get provider details to send to seeker
    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('id, name, profile_photo_url, rating_avg, phone')
      .eq('id', req.userId)
      .single();

    // Notify seeker via socket
    try {
      const io = getIO();
      io.to(`user:${booking.seeker_id}`).emit('job_accepted', {
        bookingId: id,
        provider,
        etaMinutes: 8, // TODO: calculate from actual distance
      });
    } catch (_) { /* Socket may not be available */ }

    logger.info(`Booking ${id} accepted by provider ${req.userId}`);

    return success(res, { booking: { id, status: BOOKING_STATUS.EN_ROUTE }, provider });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/bookings/:id/arrived
 * FIX BUG-010: Added status guard — only allows transition from EN_ROUTE.
 */
export const markArrived = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .update({ status: BOOKING_STATUS.IN_PROGRESS, provider_arrived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('provider_id', req.userId)
      .eq('status', BOOKING_STATUS.EN_ROUTE) // FIX BUG-010: Guard — must be en_route
      .select('seeker_id')
      .single();

    if (dbError || !booking) return notFound(res, 'Booking not found or not in en_route status');

    try {
      const io = getIO();
      io.to(`user:${booking.seeker_id}`).emit('booking_status_update', {
        bookingId: id,
        status: BOOKING_STATUS.IN_PROGRESS,
        event: 'provider_arrived',
      });
    } catch (_) { /* Socket may not be available */ }

    return success(res, null, 'Marked as arrived');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/bookings/:id/start
 * FIX BUG-009: Added status guard — only allows transition from IN_PROGRESS (after arrived).
 */
export const startService = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .update({ start_time: new Date().toISOString() })
      .eq('id', id)
      .eq('provider_id', req.userId)
      .eq('status', BOOKING_STATUS.IN_PROGRESS) // FIX BUG-009: Guard — must be in_progress
      .select('seeker_id')
      .single();

    if (dbError || !booking) return notFound(res, 'Booking not found or not in progress');

    return success(res, null, 'Service started');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/bookings/:id/complete
 * Provider marks service complete.
 * FIX BUG-005 + BUG-006: Generates OTP using crypto.randomInt and stores
 * a bcrypt hash instead of plaintext.
 */
export const completeService = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { finalPrice } = req.body;

    // FIX BUG-006: Use cryptographically secure random integer
    const otpPlain = randomInt(1000, 9999).toString();
    // FIX BUG-005: Hash the OTP before storing in the database
    const otpHash = await bcrypt.hash(otpPlain, 10);

    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .update({
        otp: otpHash, // Stored as hash, never plaintext
        final_price: finalPrice || null,
        end_time: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('provider_id', req.userId)
      .in('status', [BOOKING_STATUS.IN_PROGRESS])
      .select('seeker_id')
      .single();

    if (dbError || !booking) return notFound(res, 'Booking not found or not in progress');

    // Notify seeker to check their OTP — we return the plain OTP to the seeker
    // ONLY via direct response or FCM (never stored in plain on server)
    try {
      const io = getIO();
      io.to(`user:${booking.seeker_id}`).emit('booking_status_update', {
        bookingId: id,
        event: 'job_completed_pending_otp',
        otp: otpPlain, // Sent directly to seeker via encrypted socket channel
      });
    } catch (_) { /* Socket may not be available */ }

    return success(res, null, 'Service marked complete. Ask seeker for OTP.');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/bookings/:id/otp
 * Seeker retrieves the OTP to show to provider.
 * NOTE: Since OTP is now hashed and delivered via socket, this endpoint is
 * deprecated for new bookings. Kept for backwards compatibility.
 */
export const getOtp = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .select('otp, status, seeker_id')
      .eq('id', id)
      .single();

    if (dbError || !booking) return notFound(res, 'Booking not found');
    if (booking.seeker_id !== req.userId) return forbidden(res, 'Access denied');
    if (!booking.otp) return error(res, 'OTP not yet generated', 400);

    // Return a message directing the seeker to check their socket notification
    return success(res, null, 'Your OTP was sent via secure notification. Check the app alert.');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/bookings/:id/verify-otp
 * Provider enters the OTP from seeker. On success: mark completed, credit provider wallet.
 * FIX BUG-005: Compare OTP using bcrypt.compare against the stored hash.
 */
export const verifyOtp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    const { data: booking, error: dbError } = await supabaseAdmin
      .from('bookings')
      .select('otp, provider_id, seeker_id, final_price, quoted_price')
      .eq('id', id)
      .single();

    if (dbError || !booking) return notFound(res, 'Booking not found');
    if (booking.provider_id !== req.userId) return forbidden(res, 'Access denied');
    if (!booking.otp) return error(res, 'No OTP is pending for this booking', 400);

    // FIX BUG-005: Compare against bcrypt hash instead of plaintext
    const isOtpValid = await bcrypt.compare(String(otp), booking.otp);
    if (!isOtpValid) {
      return error(res, 'Incorrect OTP. Please ask the seeker for the correct code.', 400);
    }

    const price = booking.final_price || booking.quoted_price;
    const providerEarnings = price * (1 - PLATFORM_FEE_PERCENT / 100);

    // Mark booking as completed
    await supabaseAdmin
      .from('bookings')
      .update({
        status: BOOKING_STATUS.COMPLETED,
        payment_status: PAYMENT_STATUS.CAPTURED,
        otp: null, // Clear OTP hash after successful use
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Credit provider wallet via atomic RPC
    await supabaseAdmin.rpc('credit_wallet', {
      provider_uuid: booking.provider_id,
      amount: providerEarnings,
      booking_uuid: id,
    });

    // Notify seeker of completion
    try {
      const io = getIO();
      io.to(`user:${booking.seeker_id}`).emit('booking_status_update', {
        bookingId: id,
        status: BOOKING_STATUS.COMPLETED,
        event: 'service_completed',
        finalPrice: price,
      });
    } catch (_) { /* Socket may not be available */ }

    logger.info(`Booking ${id} completed. Provider earned Rs. ${providerEarnings.toFixed(2)}`);

    return success(res, {
      bookingId: id,
      providerEarnings: parseFloat(providerEarnings.toFixed(2)),
    }, 'Service completed successfully!');
  } catch (err) {
    next(err);
  }
};

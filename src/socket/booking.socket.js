import { supabaseAdmin } from '../config/supabase.js';
import { SOCKET_EVENTS, BOOKING_STATUS, JOB_ACCEPT_TIMEOUT_SECONDS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

/**
 * Register all booking-related Socket.IO events.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export const registerBookingEvents = (io, socket) => {

  // ─── Provider marks arrival ───────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.PROVIDER_ARRIVED, async ({ bookingId }) => {
    try {
      const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .update({ status: BOOKING_STATUS.IN_PROGRESS, provider_arrived_at: new Date().toISOString() })
        .eq('id', bookingId)
        .eq('provider_id', socket.userId)
        .select('seeker_id')
        .single();

      if (error) throw error;

      // Notify seeker that provider has arrived
      io.to(`user:${booking.seeker_id}`).emit(SOCKET_EVENTS.BOOKING_STATUS_UPDATE, {
        bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        event: 'provider_arrived',
      });

      logger.info(`Provider ${socket.userId} arrived for booking ${bookingId}`);
    } catch (err) {
      logger.error(`provider_arrived error: ${err.message}`);
      socket.emit('error', { message: 'Failed to update arrival status' });
    }
  });

  // ─── Provider starts service ──────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.JOB_STARTED, async ({ bookingId }) => {
    try {
      const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .update({ start_time: new Date().toISOString() })
        .eq('id', bookingId)
        .eq('provider_id', socket.userId)
        .select('seeker_id')
        .single();

      if (error) throw error;

      io.to(`user:${booking.seeker_id}`).emit(SOCKET_EVENTS.BOOKING_STATUS_UPDATE, {
        bookingId,
        status: 'in_progress',
        event: 'job_started',
      });
    } catch (err) {
      logger.error(`job_started error: ${err.message}`);
    }
  });

  // ─── Provider marks job complete (OTP generation happens via REST API) ────
  socket.on(SOCKET_EVENTS.JOB_COMPLETED, async ({ bookingId }) => {
    try {
      const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .select('seeker_id')
        .eq('id', bookingId)
        .eq('provider_id', socket.userId)
        .single();

      if (error) throw error;

      io.to(`user:${booking.seeker_id}`).emit(SOCKET_EVENTS.BOOKING_STATUS_UPDATE, {
        bookingId,
        event: 'job_completed_pending_otp',
      });
    } catch (err) {
      logger.error(`job_completed socket error: ${err.message}`);
    }
  });
};

/**
 * Broadcast a new job to nearby providers.
 * Called from the bookings REST controller after creating a booking.
 * @param {import('socket.io').Server} io
 * @param {string[]} providerIds - UUIDs of providers to notify
 * @param {object} jobPayload - Job details to send
 */
export const broadcastJobToProviders = (io, providerIds, jobPayload) => {
  const acceptTimer = setTimeout(() => {
    // Auto-expire: emit cancellation if no one accepted
    for (const providerId of providerIds) {
      io.to(`user:${providerId}`).emit('job_expired', { bookingId: jobPayload.bookingId });
    }
    logger.info(`Job ${jobPayload.bookingId} expired after ${JOB_ACCEPT_TIMEOUT_SECONDS}s`);
  }, JOB_ACCEPT_TIMEOUT_SECONDS * 1000);

  for (const providerId of providerIds) {
    io.to(`user:${providerId}`).emit(SOCKET_EVENTS.NEW_JOB, jobPayload);
  }

  logger.info(`Job ${jobPayload.bookingId} broadcast to ${providerIds.length} providers`);

  // Return the timer so it can be cleared on acceptance
  return acceptTimer;
};

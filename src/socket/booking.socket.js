/**
 * Booking rooms. State changes go through the REST API only (Backend Phase 3);
 * sockets just deliver updates. A user may watch a booking only if they are its
 * customer or its assigned partner.
 *   booking:watch   { bookingId } -> joins room booking:<id>
 *   booking:unwatch { bookingId }
 */
import { z } from 'zod';
import { SOCKET_EVENTS } from '../config/constants.js';
import { db } from '../config/supabase.js';
import { notFound, unwrap } from '../utils/errors.js';
import { safeOn } from './safeOn.js';

const payload = z.object({ bookingId: z.string().uuid() });

export const canWatchBooking = async (uid, bookingId) => {
  const row = unwrap(
    await db().from('bookings').select('id, customer_id, provider_id').eq('id', bookingId).maybeSingle(),
  );
  return !!row && (row.customer_id === uid || row.provider_id === uid);
};

export const registerBookingEvents = (_io, socket) => {
  safeOn(
    socket,
    SOCKET_EVENTS.BOOKING_WATCH,
    payload,
    async ({ bookingId }) => {
      if (!(await canWatchBooking(socket.data.uid, bookingId))) throw notFound('Booking');
      socket.join(`booking:${bookingId}`);
      return { watching: bookingId };
    },
    { perMinute: 30 },
  );

  safeOn(socket, SOCKET_EVENTS.BOOKING_UNWATCH, payload, ({ bookingId }) => {
    socket.leave(`booking:${bookingId}`);
    return { watching: null };
  });
};

/** Server-side helpers for controllers (Phase 3). */
export const emitBookingUpdate = (io, booking) => {
  io.to(`booking:${booking.id}`).emit(SOCKET_EVENTS.BOOKING_UPDATED, booking);
};

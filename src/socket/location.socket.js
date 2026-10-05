/**
 * Partner presence and live location.
 *   partner:online  { lat, lng }  -> only KYC-approved partners (rule 4.4)
 *   partner:offline {}
 *   partner:location { lat, lng, heading?, speed? } throttled; relayed to the
 *     customer of the partner's active booking via the booking room.
 * A dropped connection marks the partner offline after a grace period, unless
 * they reconnect (mobile networks drop often).
 */
import { z } from 'zod';
import { SOCKET_EVENTS, RULES, ACTIVE_BOOKING_STATUSES } from '../config/constants.js';
import { db } from '../config/supabase.js';
import * as providers from '../repos/providers.repo.js';
import { conflict, forbidden, unwrap } from '../utils/errors.js';
import { kick } from '../services/dispatcher.js';
import { logger } from '../utils/logger.js';
import { safeOn } from './safeOn.js';

export const OFFLINE_GRACE_MS = 60_000;
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const locationPayload = point.extend({
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(100).optional(),
});

const activeBookingFor = async (providerId) =>
  unwrap(
    await db()
      .from('bookings')
      .select('id, status')
      .eq('provider_id', providerId)
      .in('status', ACTIVE_BOOKING_STATUSES)
      .limit(1)
      .maybeSingle(),
  );

export const registerLocationEvents = (io, socket) => {
  if (!socket.data.actor.isPartner) return;
  const uid = socket.data.uid;
  let lastWrite = 0;
  let activeBooking = { id: null, status: null, checkedAt: 0 };

  const requireApproved = async () => {
    const state = await providers.getPartnerState(uid);
    if (state?.kyc_status !== 'approved')
      throw forbidden('Your KYC must be approved before you go online', 'KYC_NOT_APPROVED');
    return state;
  };

  safeOn(
    socket,
    SOCKET_EVENTS.PARTNER_ONLINE,
    point,
    async ({ lat, lng }) => {
      await requireApproved();
      await providers.setLocation(uid, lat, lng);
      const state = await providers.setOnline(uid, true);
      socket.join('partners:online');
      io.to(`user:${uid}`).emit(SOCKET_EVENTS.PARTNER_STATE, { online: true });
      logger.info('Partner online', { uid });
      kick(); // waiting bookings nearby may now have a match
      return { online: state.is_online };
    },
    { perMinute: 10 },
  );

  safeOn(
    socket,
    SOCKET_EVENTS.PARTNER_OFFLINE,
    null,
    async () => {
      // Edge case: a partner holding a job cannot go offline until it is done.
      if (await providers.hasActiveJob(uid)) {
        throw conflict('Finish or release your current job before going offline', 'ACTIVE_JOB');
      }
      await providers.setOnline(uid, false);
      socket.leave('partners:online');
      io.to(`user:${uid}`).emit(SOCKET_EVENTS.PARTNER_STATE, { online: false });
      return { online: false };
    },
    { perMinute: 10 },
  );

  safeOn(
    socket,
    SOCKET_EVENTS.PARTNER_LOCATION,
    locationPayload,
    async ({ lat, lng, heading, speed }) => {
      const now = Date.now();
      // Re-check the active booking at most every 5 s.
      if (now - activeBooking.checkedAt > 5_000) {
        const active = await activeBookingFor(uid);
        activeBooking = { id: active?.id ?? null, status: active?.status ?? null, checkedAt: now };
      }
      // Privacy: the customer sees the partner only while they travel and on arrival.
      if (activeBooking.id && (activeBooking.status === 'en_route' || activeBooking.status === 'arrived')) {
        io.to(`booking:${activeBooking.id}`).emit(SOCKET_EVENTS.BOOKING_LOCATION, {
          bookingId: activeBooking.id,
          lat,
          lng,
          heading: heading ?? null,
          speed: speed ?? null,
          at: new Date(now).toISOString(),
        });
      }
      // Throttle database writes; the relay above stays real time.
      if (now - lastWrite >= RULES.locationMinIntervalMs) {
        lastWrite = now;
        await providers.setLocation(uid, lat, lng);
      }
      return undefined;
    },
    { perMinute: 120 },
  );

  socket.on('disconnect', () => {
    setTimeout(async () => {
      try {
        const sockets = await io.in(`user:${uid}`).fetchSockets();
        if (sockets.some((s) => s.data.actor?.isPartner)) return;
        await providers.setOnline(uid, false);
        logger.info('Partner offline after disconnect', { uid });
      } catch (err) {
        logger.warn('Could not mark partner offline', { uid, error: err?.message });
      }
    }, OFFLINE_GRACE_MS).unref();
  });
};

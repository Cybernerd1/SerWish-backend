/**
 * Dispatcher worker (in-process). The matching logic lives in the database
 * function dispatch_tick(), which is atomic and guarded by an advisory lock,
 * so running several API instances is safe. This loop only calls it and turns
 * the returned events into socket messages and notifications.
 */
import * as bookings from '../repos/bookings.repo.js';
import { RULES, SOCKET_EVENTS } from '../config/constants.js';
import { toJobOffer } from '../utils/dto.js';
import { logger } from '../utils/logger.js';
import { emitToUser } from './realtime.js';
import { notify } from './notify.js';
import { publishBooking } from './bookingEvents.js';

let timer = null;
let running = null;
let again = false;

const tickArgs = () => ({
  p_offer_seconds: RULES.jobOfferSeconds,
  p_radius_km: RULES.matchRadiusKm,
  p_timeout_seconds: RULES.matchingTimeoutSeconds,
  p_lead_minutes: RULES.dispatchLeadMinutes,
  p_batch: 50,
});

const handle = async (ev) => {
  switch (ev.kind) {
    case 'offer_new': {
      const offer = await bookings.getOfferForPartner(ev.offer_id, ev.provider_id);
      if (!offer) return;
      const card = toJobOffer(offer);
      emitToUser(ev.provider_id, SOCKET_EVENTS.JOB_OFFER, card);
      await notify(ev.provider_id, {
        kind: 'job',
        title: 'New job request',
        body: `${card.serviceName} in ${card.area || 'your area'}, ${card.distanceKm ?? '?'} km away. Accept within ${RULES.jobOfferSeconds} s.`,
        data: { bookingId: ev.booking_id, offerId: ev.offer_id, icon: 'feature' },
      });
      return;
    }
    case 'offer_expired':
      emitToUser(ev.provider_id, SOCKET_EVENTS.JOB_OFFER_CLOSED, {
        offerId: ev.offer_id,
        bookingId: ev.booking_id,
        reason: 'expired',
      });
      return;
    case 'no_providers':
      await publishBooking(ev.booking_id, { previousStatus: 'searching' });
      return;
    default:
  }
};

/** Run one tick now. Overlapping calls collapse into one follow-up run. */
export const runTick = async () => {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const events = (await bookings.dispatchTick(tickArgs())) ?? [];
        for (const ev of events) {
          await handle(ev).catch((err) => logger.warn('Dispatch event failed', { kind: ev.kind, error: err?.message }));
        }
      } while (again);
    } catch (err) {
      logger.error('Dispatcher tick failed', { error: err?.message });
    } finally {
      running = null;
    }
  })();
  return running;
};

/** Ask for a tick soon (after a booking is created, an offer rejected, a partner goes online). */
export const kick = () => {
  setImmediate(() => {
    runTick();
  });
};

export const startDispatcher = () => {
  if (timer) return;
  timer = setInterval(runTick, RULES.dispatchIntervalMs);
  timer.unref();
  logger.info(`Dispatcher running every ${RULES.dispatchIntervalMs} ms`);
};

export const stopDispatcher = async () => {
  if (timer) clearInterval(timer);
  timer = null;
  if (running) await running;
};

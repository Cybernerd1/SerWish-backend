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

// While dispatch_tick() keeps failing (an unreachable database, say) retries
// back off towards one a minute, and the identical error stops being written
// on every one of them.
const BACKOFF_MAX_MS = 60_000;
const LOG_REPEAT_MS = 5 * 60 * 1000;

let failures = 0;
let retryAt = 0;
let lastError = null;
let lastLoggedAt = 0;
let suppressed = 0;

const noteFailure = (err) => {
  const message = err?.message ?? 'unknown error';
  const now = Date.now();
  failures += 1;
  retryAt = now + Math.min(RULES.dispatchIntervalMs * 2 ** (failures - 1), BACKOFF_MAX_MS);
  if (message !== lastError || now - lastLoggedAt >= LOG_REPEAT_MS) {
    logger.error('Dispatcher tick failed', {
      error: message,
      consecutiveFailures: failures,
      retryInMs: retryAt - now,
      ...(suppressed && { repeatsSinceLastLog: suppressed }),
    });
    lastError = message;
    lastLoggedAt = now;
    suppressed = 0;
  } else {
    suppressed += 1;
  }
};

const noteSuccess = () => {
  if (failures) logger.info('Dispatcher recovered', { afterFailures: failures, lastError });
  failures = 0;
  retryAt = 0;
  lastError = null;
  suppressed = 0;
};

/** Test hook: forget the backoff state between cases. */
export const __resetDispatcherBackoff = () => {
  failures = 0;
  retryAt = 0;
  lastError = null;
  lastLoggedAt = 0;
  suppressed = 0;
};

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
      noteSuccess();
    } catch (err) {
      noteFailure(err);
    } finally {
      running = null;
    }
  })();
  return running;
};

/**
 * A tick on behalf of the timer or a kick, skipped while the backoff from a
 * run of failures is still open. Direct runTick() callers are never skipped.
 */
const scheduledTick = () => (failures && Date.now() < retryAt ? Promise.resolve() : runTick());

/** Ask for a tick soon (after a booking is created, an offer rejected, a partner goes online). */
export const kick = () => {
  setImmediate(() => {
    scheduledTick();
  });
};

export const startDispatcher = () => {
  if (timer) return;
  timer = setInterval(scheduledTick, RULES.dispatchIntervalMs);
  timer.unref();
  logger.info(`Dispatcher running every ${RULES.dispatchIntervalMs} ms`);
};

export const stopDispatcher = async () => {
  if (timer) clearInterval(timer);
  timer = null;
  if (running) await running;
};

/**
 * Bookings (Backend Phase 3). REST is the only writer; the database enforces
 * the state machine, and every change is pushed to both apps by publishBooking().
 */
import * as bookings from '../repos/bookings.repo.js';
import * as addresses from '../repos/addresses.repo.js';
import * as providers from '../repos/providers.repo.js';
import { estimate } from '../services/pricing.js';
import { kick } from '../services/dispatcher.js';
import { publishBooking } from '../services/bookingEvents.js';
import { emitToUser } from '../services/realtime.js';
import { RULES, SOCKET_EVENTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { db } from '../config/supabase.js';
import { toBooking, toJobOffer } from '../utils/dto.js';
import { created, ok } from '../utils/response.js';
import { AppError, badRequest, conflict, forbidden, notFound, unwrap, validationFailed } from '../utils/errors.js';

const ONLINE_METHODS = new Set(['card', 'netbanking']);

const viewerOf = (row, actorId) =>
  row.provider_id === actorId && row.customer_id !== actorId ? 'partner' : 'customer';

const addressText = (a) => [a.line1, a.line2, `${a.city} ${a.pincode}`].filter(Boolean).join(', ');

/** POST /bookings/estimate - the exact bill the customer will see. */
export const estimateBooking = async (req, res) => ok(res, await estimate(req.body, req.actor.id));

/** POST /bookings - create (idempotent with the Idempotency-Key header). */
export const createBooking = async (req, res) => {
  const me = req.actor.id;
  const key = req.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    throw badRequest('Send an Idempotency-Key header (8-80 letters, digits, - or _) so retries never double-book');
  }
  const existing = await bookings.findByIdempotencyKey(me, key);
  if (existing) return ok(res, toBooking(existing, 'customer'), { message: 'Already booked' });

  const b = req.body;
  if (ONLINE_METHODS.has(b.paymentMethod) && !env.FEATURE_PAYMENTS) {
    throw validationFailed([
      {
        field: 'body.paymentMethod',
        message: 'Card and net banking arrive with online payments. Use UPI or cash for now.',
      },
    ]);
  }

  if ((await bookings.countActiveForCustomer(me)) >= RULES.maxActiveBookings) {
    throw conflict(`You can have up to ${RULES.maxActiveBookings} active bookings at a time`, 'TOO_MANY_ACTIVE');
  }

  // Schedule
  const now = Date.now();
  let scheduledAt = new Date(now).toISOString();
  if (b.scheduleType === 'later') {
    const at = Date.parse(b.scheduledAt);
    if (at < now + RULES.minScheduleLeadMinutes * 60_000) {
      throw validationFailed([
        { field: 'body.scheduledAt', message: `Pick a slot at least ${RULES.minScheduleLeadMinutes} minutes from now` },
      ]);
    }
    if (at > now + RULES.maxScheduleDays * 86_400_000) {
      throw validationFailed([
        { field: 'body.scheduledAt', message: `Pick a slot within the next ${RULES.maxScheduleDays} days` },
      ]);
    }
    scheduledAt = new Date(at).toISOString();
  }

  const address = await addresses.getForUser(me, b.addressId);
  const bill = await estimate(b, me);

  if (b.couponCode && !bill.coupon?.applied) {
    throw new AppError(409, 'COUPON_NOT_APPLICABLE', bill.coupon?.reason ?? 'This code cannot be used', {
      estimate: bill,
    });
  }
  if (b.expectedTotal !== undefined && b.expectedTotal !== bill.total) {
    throw new AppError(409, 'PRICE_CHANGED', 'The price has changed. Please review the new total.', { estimate: bill });
  }

  if (b.preferredProviderId) {
    const pro = await providers.getPublicProfile(b.preferredProviderId);
    if (!pro || pro.user_id === me) throw badRequest('This professional is not available');
    const extras = await providers.getProfileExtras(pro.user_id);
    if (!extras.serviceIds.includes(bill.service.id)) throw badRequest('This professional does not offer this service');
  }

  const row = {
    customer_id: me,
    service_id: bill.service.id,
    package_id: bill.package?.id ?? null,
    preferred_provider_id: b.preferredProviderId ?? null,
    schedule_type: b.scheduleType,
    scheduled_at: scheduledAt,
    address_id: address.id,
    address_text: addressText(address),
    location: `SRID=4326;POINT(${address.lng} ${address.lat})`,
    notes: b.notes ?? null,
    extras: bill.extras,
    base_price: bill.basePrice,
    extras_total: bill.extrasTotal,
    discount: bill.discount,
    platform_fee: bill.platformFee,
    total: bill.total,
    coupon_code: bill.coupon?.applied ? bill.coupon.code : null,
    payment_method: b.paymentMethod,
    idempotency_key: key,
  };

  const result = await bookings.insert(row);
  if (result.error?.code === '23505') {
    const again = await bookings.findByIdempotencyKey(me, key);
    if (again) return ok(res, toBooking(again, 'customer'), { message: 'Already booked' });
  }
  const booking = unwrap(result);
  kick();
  return created(
    res,
    toBooking(booking, 'customer'),
    b.scheduleType === 'now' ? 'Finding a professional' : 'Booking scheduled',
  );
};

export const listBookings = async (req, res) => {
  const { as, status, limit, offset } = req.query;
  if (as === 'partner' && !req.actor.isPartner) throw forbidden('Only SerWish partners can do this', 'PARTNER_ONLY');
  const { rows, total } = await bookings.listForActor(req.actor.id, { as, filter: status, limit, offset });
  return ok(
    res,
    rows.map((r) => toBooking(r, as === 'partner' ? 'partner' : 'customer')),
    { meta: { total, limit, offset } },
  );
};

const loadMine = async (req) => {
  const row = await bookings.getForActor(req.params.id, req.actor.id);
  if (!row) throw notFound('Booking');
  return row;
};

export const getBooking = async (req, res) => {
  const row = await loadMine(req);
  return ok(res, toBooking(row, viewerOf(row, req.actor.id)));
};

/** POST /bookings/:id/cancel - customer cancels, or the partner drops out (re-dispatch). */
export const cancelBooking = async (req, res) => {
  const row = await loadMine(req);
  const role = viewerOf(row, req.actor.id) === 'partner' ? 'provider' : 'customer';
  const reason = req.body.reason;
  const updated = await bookings.cancel(row.id, req.actor.id, role, reason);

  if (role === 'provider') {
    kick(); // offer it to the next partner
    await publishBooking(row.id, { previousStatus: row.status, previousProviderId: row.provider_id });
    const fresh = await bookings.getById(row.id);
    return ok(
      res,
      { id: fresh.id, status: fresh.status === 'searching' ? 'released' : fresh.status },
      { message: 'Job released' },
    );
  }

  const partnerMessage = row.provider_id
    ? {
        userId: row.provider_id,
        msg: {
          title: 'Job cancelled',
          body: `The customer cancelled the ${row.service?.name ?? 'job'}${reason ? `: ${reason}` : ''}.`,
        },
      }
    : undefined;
  const fresh = await publishBooking(updated.id, { previousStatus: row.status, partnerMessage });
  return ok(res, toBooking(fresh ?? (await bookings.getById(row.id)), 'customer'), { message: 'Booking cancelled' });
};

/**
 * POST /bookings/:id/reschedule - move a booking that nobody has started on yet.
 * An assigned partner is released and the job is offered again near the new slot.
 */
export const rescheduleBooking = async (req, res) => {
  const row = await loadMine(req);
  if (row.customer_id !== req.actor.id) throw notFound('Booking');
  const at = Date.parse(req.body.scheduledAt);
  if (at > Date.now() + RULES.maxScheduleDays * 86_400_000) {
    throw validationFailed([
      { field: 'body.scheduledAt', message: `Pick a slot within the next ${RULES.maxScheduleDays} days` },
    ]);
  }
  await bookings.reschedule(row.id, req.actor.id, new Date(at).toISOString());
  const partnerMessage = row.provider_id
    ? {
        userId: row.provider_id,
        msg: {
          title: 'Job rescheduled',
          body: `The customer moved the ${row.service?.name ?? 'job'} to a new time. It has been released.`,
        },
      }
    : undefined;
  const fresh = await publishBooking(row.id, {
    previousStatus: row.status,
    previousProviderId: row.provider_id,
    notifyCustomer: false,
    partnerMessage,
  });
  kick();
  return ok(res, toBooking(fresh ?? (await bookings.getById(row.id)), 'customer'), { message: 'Booking rescheduled' });
};

/* ---------- Partner moves ---------- */

const loadAssigned = async (req) => {
  const row = await bookings.getById(req.params.id);
  if (!row || row.provider_id !== req.actor.id) throw notFound('Booking');
  return row;
};

const move = (to, message) => async (req, res) => {
  const row = await loadAssigned(req);
  await bookings.partnerTransition(row.id, req.actor.id, to);
  const fresh = await publishBooking(row.id, { previousStatus: row.status });
  return ok(res, toBooking(fresh ?? (await bookings.getById(row.id)), 'partner'), { message });
};

export const startTrip = move('en_route', 'On the way');
export const arrive = move('arrived', 'Marked as arrived');
export const startJob = move('in_progress', 'Job started');

/**
 * POST /bookings/:id/complete
 * Owner decision: the partner completes only after receiving the payment
 * (cash or UPI to the partner), so the amount must equal the booking total.
 */
export const completeJob = async (req, res) => {
  const row = await loadAssigned(req);
  const { method, amountReceived } = req.body;
  await bookings.complete(row.id, req.actor.id, method, amountReceived);
  const fresh = await publishBooking(row.id, { previousStatus: row.status });
  return ok(res, toBooking(fresh ?? (await bookings.getById(row.id)), 'partner'), { message: 'Job completed' });
};

/* ---------- Job offers (partner) ---------- */

export const listMyOffers = async (req, res) => {
  const open = await bookings.listOpenOffers(req.actor.id);
  const cards = await Promise.all(open.map((o) => bookings.getOfferForPartner(o.id, req.actor.id)));
  return ok(res, cards.filter(Boolean).map(toJobOffer));
};

export const getOffer = async (req, res) => {
  const offer = await bookings.getOfferForPartner(req.params.id, req.actor.id);
  if (!offer) throw notFound('Job offer');
  return ok(res, toJobOffer(offer));
};

export const acceptOffer = async (req, res) => {
  const accepted = await bookings.acceptOffer(req.params.id, req.actor.id);
  emitToUser(req.actor.id, SOCKET_EVENTS.JOB_OFFER_CLOSED, {
    offerId: req.params.id,
    bookingId: accepted.id,
    reason: 'accepted_by_you',
  });
  const fresh = await publishBooking(accepted.id, { previousStatus: 'searching' });
  return ok(res, toBooking(fresh ?? (await bookings.getById(accepted.id)), 'partner'), { message: 'Job accepted' });
};

export const rejectOffer = async (req, res) => {
  const offer = await bookings.rejectOffer(req.params.id, req.actor.id);
  kick();
  return ok(res, { id: offer.id, bookingId: offer.booking_id, status: offer.status }, { message: 'Job declined' });
};

/** v1 alias: POST /bookings/:id/accept accepts my open offer for that booking. */
export const acceptByBooking = async (req, res) => {
  const offer = unwrap(
    await db()
      .from('booking_offers')
      .select('id')
      .eq('booking_id', req.params.id)
      .eq('provider_id', req.actor.id)
      .eq('status', 'offered')
      .maybeSingle(),
  );
  if (!offer) throw conflict('This job is no longer available', 'RULE_VIOLATION');
  req.params.id = offer.id;
  return acceptOffer(req, res);
};

/* ---------- Reviews ---------- */

/** POST /bookings/:id/review - optional, once, completed bookings only. */
export const reviewBooking = async (req, res) => {
  const row = await loadMine(req);
  if (row.customer_id !== req.actor.id) throw notFound('Booking');
  if (row.status !== 'completed') throw conflict('You can rate a booking after it is completed', 'RULE_VIOLATION');
  const result = await bookings.insertReview({
    booking_id: row.id,
    customer_id: row.customer_id,
    provider_id: row.provider_id,
    rating: req.body.rating,
    tags: req.body.tags ?? [],
    comment: req.body.text ?? null,
  });
  if (result.error?.code === '23505') throw conflict('You have already rated this booking', 'ALREADY_REVIEWED');
  const review = unwrap(result);
  return created(
    res,
    { rating: review.rating, text: review.comment ?? '', tags: review.tags, at: review.created_at },
    'Thanks for your feedback',
  );
};

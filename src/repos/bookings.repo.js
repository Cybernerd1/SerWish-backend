/** Bookings, job offers and reviews. Every read is scoped to the caller. */
import { db } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';
import { ACTIVE_BOOKING_STATUSES } from '../config/constants.js';

// Explicit allow-list: never otp_hash / otp_* / idempotency_key in responses.
export const BOOKING_COLS = `id, code, customer_id, provider_id, preferred_provider_id, service_id, package_id, status,
  schedule_type, scheduled_at, address_id, address_text, notes, extras, base_price, extras_total, discount,
  platform_fee, total, coupon_code, payment_method, payment_status, cancelled_by, cancel_reason,
  assigned_at, en_route_at, arrived_at, started_at, completed_at, cancelled_at, created_at, updated_at,
  lat, lng,
  service:services!bookings_service_id_fkey(id, slug, name, image_url, duration_mins),
  package:service_packages!bookings_package_id_fkey(id, name, pros_count),
  customer:users!bookings_customer_id_fkey(id, name, photo_url),
  provider:provider_profiles!bookings_provider_id_fkey(user_id, headline, rating_avg, rating_count, total_jobs,
    user:users!provider_profiles_user_id_fkey(name, photo_url)),
  review:reviews!reviews_booking_id_fkey(rating, comment, tags, created_at),
  events:booking_events(to_status, created_at)`;

export const getById = async (id) =>
  unwrap(await db().from('bookings').select(BOOKING_COLS).eq('id', id).maybeSingle());

/** A booking the caller may see: they are the customer or the assigned partner. */
export const getForActor = async (id, actorId) => {
  const row = await getById(id);
  if (!row || (row.customer_id !== actorId && row.provider_id !== actorId)) return null;
  return row;
};

export const findByIdempotencyKey = async (customerId, key) =>
  unwrap(
    await db()
      .from('bookings')
      .select(BOOKING_COLS)
      .eq('customer_id', customerId)
      .eq('idempotency_key', key)
      .maybeSingle(),
  );

export const countActiveForCustomer = async (customerId) => {
  const { count, error } = await db()
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .in('status', ['searching', ...ACTIVE_BOOKING_STATUSES]);
  if (error) unwrap({ error });
  return count ?? 0;
};

/** Has the customer ever had a booking that was not cancelled / unmatched? */
export const hasPriorBooking = async (customerId) => {
  const { count, error } = await db()
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .not('status', 'in', '(cancelled,no_providers)');
  if (error) unwrap({ error });
  return (count ?? 0) > 0;
};

export const insert = async (row) => {
  const res = await db().from('bookings').insert(row).select(BOOKING_COLS).single();
  return res;
};

const FILTERS = {
  active: ['searching', ...ACTIVE_BOOKING_STATUSES],
  completed: ['completed'],
  cancelled: ['cancelled', 'no_providers'],
};

export const listForActor = async (actorId, { as, filter, limit, offset }) => {
  let q = db()
    .from('bookings')
    .select(BOOKING_COLS, { count: 'exact' })
    .eq(as === 'partner' ? 'provider_id' : 'customer_id', actorId);
  if (filter && FILTERS[filter]) q = q.in('status', FILTERS[filter]);
  const { data, error, count } = await q
    .order(filter === 'active' ? 'scheduled_at' : 'created_at', { ascending: filter === 'active' })
    .range(offset, offset + limit - 1);
  return { rows: unwrap({ data, error }), total: count ?? 0 };
};

const rpc = async (fn, args) => unwrap(await db().rpc(fn, args));

export const acceptOffer = (offerId, providerId) =>
  rpc('accept_booking_offer', { p_offer_id: offerId, p_provider_id: providerId });
export const rejectOffer = (offerId, providerId) =>
  rpc('reject_booking_offer', { p_offer_id: offerId, p_provider_id: providerId });
export const partnerTransition = (bookingId, providerId, to) =>
  rpc('partner_transition', { p_booking_id: bookingId, p_provider_id: providerId, p_to: to });
export const complete = (bookingId, providerId, method, amount) =>
  rpc('complete_booking', { p_booking_id: bookingId, p_provider_id: providerId, p_method: method, p_amount: amount });
export const cancel = (bookingId, actorId, role, reason) =>
  rpc('cancel_booking', { p_booking_id: bookingId, p_actor_id: actorId, p_role: role, p_reason: reason });
export const dispatchTick = (args) => rpc('dispatch_tick', args);
export const reschedule = (bookingId, customerId, at) =>
  rpc('reschedule_booking', { p_booking_id: bookingId, p_customer_id: customerId, p_at: at });

/** Offer + booking summary for the partner's incoming-job card. */
export const getOfferForPartner = async (offerId, providerId) =>
  unwrap(
    await db()
      .from('booking_offers')
      .select(
        `id, booking_id, provider_id, status, rank, distance_km, offered_at, expires_at,
         booking:bookings!booking_offers_booking_id_fkey(id, code, status, schedule_type, scheduled_at, address_text,
           notes, extras, total, platform_fee,
           service:services!bookings_service_id_fkey(id, name, image_url, duration_mins),
           package:service_packages!bookings_package_id_fkey(name),
           customer:users!bookings_customer_id_fkey(name))`,
      )
      .eq('id', offerId)
      .eq('provider_id', providerId)
      .maybeSingle(),
  );

export const listOpenOffers = async (providerId) =>
  unwrap(
    await db()
      .from('booking_offers')
      .select('id')
      .eq('provider_id', providerId)
      .eq('status', 'offered')
      .gt('expires_at', new Date().toISOString()),
  );

export const insertReview = async (row) =>
  db().from('reviews').insert(row).select('id, rating, comment, tags, created_at').single();

/**
 * Server-side pricing (rule: no surprise charges). The app shows exactly what
 * estimate() returns and the booking stores the same numbers.
 *   total = base (package or service price) + extras - discount + platform fee
 */
import * as catalog from '../repos/catalog.repo.js';
import * as bookings from '../repos/bookings.repo.js';
import { db } from '../config/supabase.js';
import { RULES } from '../config/constants.js';
import { badRequest, notFound, unwrap } from '../utils/errors.js';

const getOffer = async (code) =>
  unwrap(
    await db()
      .from('offers')
      .select(
        'code, title, kind, value, max_discount, min_order, category_id, valid_from, valid_to, is_active, first_booking_only',
      )
      .eq('code', code)
      .maybeSingle(),
  );

/** Pure coupon maths, exported for tests. Returns { discount, reason? }. */
export const applyCoupon = (offer, { subtotal, categoryId, now = new Date(), hasPriorBooking = false }) => {
  if (!offer || !offer.is_active) return { discount: 0, reason: 'This code is not valid' };
  if (offer.valid_from && new Date(offer.valid_from) > now)
    return { discount: 0, reason: 'This code is not active yet' };
  if (offer.valid_to && new Date(offer.valid_to) < now) return { discount: 0, reason: 'This code has expired' };
  if (offer.category_id && offer.category_id !== categoryId)
    return { discount: 0, reason: 'This code does not apply to this service' };
  if (offer.min_order && subtotal < offer.min_order)
    return { discount: 0, reason: `Add items worth ₹${offer.min_order - subtotal} more to use this code` };
  if (offer.first_booking_only && hasPriorBooking)
    return { discount: 0, reason: 'This code is for your first booking only' };
  let discount = offer.kind === 'percent' ? Math.floor((subtotal * offer.value) / 100) : offer.value;
  if (offer.max_discount) discount = Math.min(discount, offer.max_discount);
  return { discount: Math.max(0, Math.min(discount, subtotal)) };
};

/**
 * @param {{ serviceId: string, packageId?: string, extraIds?: string[], couponCode?: string }} input
 * @param {string} customerId
 */
export const estimate = async (input, customerId) => {
  const service = await catalog.getService(input.serviceId);
  if (!service) throw notFound('Service');

  let pkg = null;
  if (input.packageId) {
    pkg = service.packages.find((p) => p.id === input.packageId);
    if (!pkg) throw badRequest('This package is not part of the service');
  }
  const wanted = [...new Set(input.extraIds ?? [])];
  const extras = wanted.map((id) => {
    const x = service.extras.find((e) => e.id === id);
    if (!x) throw badRequest('An add-on is not part of the service');
    return { id: x.id, name: x.name, price: x.price };
  });

  const basePrice = pkg ? pkg.price : service.base_price;
  const extrasTotal = extras.reduce((sum, x) => sum + x.price, 0);
  const subtotal = basePrice + extrasTotal;

  let coupon = null;
  let discount = 0;
  if (input.couponCode) {
    const code = input.couponCode.trim().toUpperCase();
    const offer = await getOffer(code);
    const prior = offer?.first_booking_only ? await bookings.hasPriorBooking(customerId) : false;
    const result = applyCoupon(offer, { subtotal, categoryId: service.category_id, hasPriorBooking: prior });
    discount = result.discount;
    coupon = { code, applied: result.discount > 0, discount: result.discount, reason: result.reason ?? null };
  }

  const platformFee = RULES.platformFeeInr;
  return {
    service: { id: service.id, name: service.name, durationMins: pkg?.duration_mins ?? service.duration_mins },
    package: pkg ? { id: pkg.id, name: pkg.name, pros: pkg.pros_count } : null,
    extras,
    basePrice,
    extrasTotal,
    subtotal,
    discount,
    platformFee,
    total: subtotal - discount + platformFee,
    coupon,
    cancellationFee: RULES.cancellationFeeInr,
  };
};

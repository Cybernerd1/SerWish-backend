import { describe, expect, it } from 'vitest';
import { applyCoupon } from '../src/services/pricing.js';

const offer = (o) => ({ is_active: true, kind: 'percent', value: 50, ...o });

describe('coupon maths', () => {
  it('percent with a cap (SERWISH50: 50% up to 200)', () => {
    expect(applyCoupon(offer({ max_discount: 200 }), { subtotal: 299 }).discount).toBe(149);
    expect(applyCoupon(offer({ max_discount: 200 }), { subtotal: 1000 }).discount).toBe(200);
  });

  it('flat amount never exceeds the subtotal', () => {
    expect(applyCoupon(offer({ kind: 'flat', value: 100 }), { subtotal: 60 }).discount).toBe(60);
  });

  it('minimum order explains how much more to add', () => {
    const r = applyCoupon(offer({ value: 20, min_order: 499 }), { subtotal: 299 });
    expect(r.discount).toBe(0);
    expect(r.reason).toContain('200');
  });

  it('category, dates, first booking and inactive codes are refused with a reason', () => {
    expect(applyCoupon(offer({ category_id: 'pest' }), { subtotal: 500, categoryId: 'clean' }).reason).toMatch(
      /does not apply/,
    );
    expect(applyCoupon(offer({ valid_to: '2020-01-01' }), { subtotal: 500 }).reason).toMatch(/expired/);
    expect(applyCoupon(offer({ valid_from: '2999-01-01' }), { subtotal: 500 }).reason).toMatch(/not active yet/);
    expect(applyCoupon(offer({ first_booking_only: true }), { subtotal: 500, hasPriorBooking: true }).reason).toMatch(
      /first booking/,
    );
    expect(applyCoupon(offer({ is_active: false }), { subtotal: 500 }).reason).toMatch(/not valid/);
    expect(applyCoupon(null, { subtotal: 500 }).discount).toBe(0);
  });

  it('rounds percent discounts down to whole rupees', () => {
    expect(applyCoupon(offer({ value: 30 }), { subtotal: 399 }).discount).toBe(119);
  });
});

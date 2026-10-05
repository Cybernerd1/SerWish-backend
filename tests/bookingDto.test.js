import { describe, expect, it } from 'vitest';
import { appStatusFor, areaOf, toBooking, toJobOffer } from '../src/utils/dto.js';

const row = (o = {}) => ({
  id: 'b1',
  code: 'SWABC12345',
  status: 'assigned',
  schedule_type: 'now',
  scheduled_at: new Date().toISOString(),
  customer_id: 'c1',
  provider_id: 'p1',
  address_text: 'B-120, Sector 56, Gurugram 122011',
  lat: 28.4,
  lng: 77.1,
  extras: [{ id: 'x1', name: 'Inside Fridge', price: 99 }],
  base_price: 299,
  extras_total: 99,
  discount: 0,
  platform_fee: 0,
  total: 398,
  payment_method: 'cash',
  payment_status: 'pending',
  otp_hash: 'secret',
  idempotency_key: 'k-12345678',
  created_at: new Date().toISOString(),
  assigned_at: new Date().toISOString(),
  provider: { user_id: 'p1', headline: 'Expert', rating_avg: '4.80', rating_count: 10, user: { name: 'Ravi' } },
  customer: { id: 'c1', name: 'Ayush', photo_url: null },
  ...o,
});

describe('booking DTOs', () => {
  it('maps lifecycle states onto the app tabs', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(appStatusFor({ status: 'searching', schedule_type: 'later', scheduled_at: future })).toBe('upcoming');
    expect(appStatusFor({ status: 'assigned', schedule_type: 'later', scheduled_at: future })).toBe('upcoming');
    expect(appStatusFor({ status: 'searching', schedule_type: 'now', scheduled_at: new Date().toISOString() })).toBe(
      'ongoing',
    );
    expect(appStatusFor({ status: 'en_route', schedule_type: 'later', scheduled_at: future })).toBe('ongoing');
    expect(appStatusFor({ status: 'no_providers' })).toBe('cancelled');
    expect(appStatusFor({ status: 'completed' })).toBe('completed');
  });

  it('never exposes OTP hashes or idempotency keys', () => {
    for (const viewer of ['customer', 'partner']) {
      const json = JSON.stringify(toBooking(row(), viewer));
      expect(json).not.toContain('secret');
      expect(json).not.toContain('k-12345678');
    }
  });

  it('customer sees the partner; partner sees the customer and payout', () => {
    const c = toBooking(row(), 'customer');
    expect(c.provider).toMatchObject({ id: 'p1', name: 'Ravi', rating: 4.8 });
    expect(c.customer).toBeUndefined();
    const p = toBooking(row({ platform_fee: 20, total: 418 }), 'partner');
    expect(p.customer.name).toBe('Ayush');
    expect(p.payout).toBe(398);
    expect(p.provider).toBeUndefined();
  });

  it('timeline marks done steps', () => {
    const t = toBooking(row(), 'customer').timeline;
    expect(t.map((s) => s.done)).toEqual([true, true, false, false, false, false]);
  });

  it('job offers show only the locality, never the house number', () => {
    expect(areaOf('B-120, Sector 56, Gurugram 122011')).toBe('Sector 56, Gurugram 122011');
    const card = toJobOffer({ id: 'o1', booking_id: 'b1', distance_km: '2.10', booking: row() });
    expect(card.area).not.toContain('B-120');
    expect(card.distanceKm).toBe(2.1);
    expect(card.payout).toBe(398);
  });
});

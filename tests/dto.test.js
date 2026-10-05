import { describe, expect, it } from 'vitest';
import { ratingBreakdown, toAddress, toProviderDetail, toService, toUser } from '../src/utils/dto.js';

describe('DTO mappers', () => {
  it('never returns columns that are not allow-listed', () => {
    const user = toUser({ id: 'u1', name: 'A', is_admin: false, otp_hash: 'x', deleted_at: null, created_at: 't' });
    expect(JSON.stringify(user)).not.toContain('otp');
    expect(user.role).toBe('seeker');
    expect(toUser({ id: 'u1' }, { providerProfile: { kyc_status: 'pending' } })).toMatchObject({
      role: 'provider',
      kycStatus: 'pending',
    });
  });

  it('hides KYC document paths and exact location from partner profiles', () => {
    const out = toProviderDetail({
      profile: {
        user_id: 'p1',
        kyc_status: 'approved',
        kyc_id_doc_path: 'kyc/p1/id.jpg',
        kyc_cert_doc_path: 'kyc/p1/cert.jpg',
        current_location: '0101000020E6',
        user: { name: 'Ravi' },
      },
      categories: ['cleaning'],
      serviceIds: [],
      gallery: [],
      breakdown: [0, 0, 0, 0, 0],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain('kyc/');
    expect(json).not.toContain('0101000020E6');
    expect(out.verified).toBe(true);
  });

  it('maps services with packages in display order', () => {
    const s = toService({
      id: 's1',
      slug: 'home-clean',
      name: 'Home Cleaning',
      base_price: 299,
      duration_mins: 120,
      rating_avg: '4.80',
      category: { slug: 'cleaning' },
      packages: [
        {
          id: 'b',
          name: 'Standard',
          price: 404,
          duration_mins: 180,
          pros_count: 2,
          display_order: 2,
          is_popular: true,
        },
        { id: 'a', name: 'Basic', price: 299, duration_mins: 120, pros_count: 1, display_order: 1 },
      ],
    });
    expect(s.rating).toBe(4.8);
    expect(s.categorySlug).toBe('cleaning');
    expect(s.packages.map((p) => p.name)).toEqual(['Basic', 'Standard']);
    expect(s.packages[1].popular).toBe(true);
  });

  it('labels addresses like the app', () => {
    expect(toAddress({ id: 'a', label: 'work', line1: 'x', city: 'G', pincode: '122002', lat: 1, lng: 2 }).label).toBe(
      'Work',
    );
  });

  it('rating breakdown always sums to 100 (or is empty)', () => {
    expect(ratingBreakdown([])).toEqual([0, 0, 0, 0, 0]);
    for (const sample of [[5], [5, 4, 3], [5, 5, 4, 1, 2, 2, 3], Array.from({ length: 97 }, (_, i) => (i % 5) + 1)]) {
      const b = ratingBreakdown(sample);
      expect(b.reduce((a, c) => a + c, 0)).toBe(100);
    }
    expect(ratingBreakdown([5, 5, 5, 4])).toEqual([75, 25, 0, 0, 0]);
  });
});

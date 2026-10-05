import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

const base = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
};

describe('env', () => {
  it('applies the owner decisions as defaults', () => {
    const env = parseEnv(base);
    expect(env.MATCH_RADIUS_KM).toBe(5);
    expect(env.JOB_OFFER_SECONDS).toBe(45);
    expect(env.PLATFORM_FEE_INR).toBe(0);
    expect(env.CANCELLATION_FEE_INR).toBe(0);
    expect(env.NODE_ENV).toBe('production');
    expect(env.FEATURE_BOOKINGS).toBe(true);
    expect(env.FEATURE_PAYMENTS).toBe(false);
    expect(env.DISPATCH_LEAD_MINUTES).toBe(60);
  });

  it('fails fast with a readable message', () => {
    expect(() => parseEnv({ ...base, SUPABASE_URL: 'not a url' })).toThrow(/SUPABASE_URL/);
    expect(() => parseEnv({ SUPABASE_URL: base.SUPABASE_URL })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('requires Firebase credentials outside tests', () => {
    const { FIREBASE_SERVICE_ACCOUNT_JSON: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow(/Firebase Admin credentials/);
    expect(() => parseEnv({ ...rest, NODE_ENV: 'test' })).not.toThrow();
  });

  it('rejects a wildcard CORS origin in production', () => {
    expect(() => parseEnv({ ...base, ALLOWED_ORIGINS: '*' })).toThrow(/not allowed/);
    expect(parseEnv({ ...base, ALLOWED_ORIGINS: 'https://admin.serwish.in, https://x.y' }).ALLOWED_ORIGINS).toEqual([
      'https://admin.serwish.in',
      'https://x.y',
    ]);
  });

  it('validates numeric ranges', () => {
    expect(() => parseEnv({ ...base, MATCH_RADIUS_KM: '500' })).toThrow(/MATCH_RADIUS_KM/);
    expect(parseEnv({ ...base, JOB_OFFER_SECONDS: '60' }).JOB_OFFER_SECONDS).toBe(60);
  });
});

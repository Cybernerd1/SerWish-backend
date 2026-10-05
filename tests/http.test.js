import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { __setFirebaseAuthForTests } from '../src/config/firebase.js';
import { makeFakeAuth } from './helpers/fakeFirebase.js';

let app;
const fake = makeFakeAuth();

beforeAll(() => {
  app = createApp();
});

describe('HTTP basics (no database)', () => {
  it('health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown routes are JSON 404s', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: 'ROUTE_NOT_FOUND' });
  });

  it('rejects malformed and oversized JSON', async () => {
    const bad = await request(app).post('/api/v1/auth/session').set('content-type', 'application/json').send('{"a":');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_JSON');
    const big = await request(app)
      .post('/api/v1/auth/session')
      .send({ idToken: 'x'.repeat(200 * 1024) });
    expect(big.status).toBe(413);
  });

  it('public config reflects the owner decisions', async () => {
    const res = await request(app).get('/api/v1/config');
    expect(res.body.data).toMatchObject({
      matchRadiusKm: 5,
      jobOfferSeconds: 45,
      platformFee: 0,
      cancellationFee: 0,
      walletEnabled: false,
    });
  });

  it('returns 503 when Firebase is not configured', async () => {
    __setFirebaseAuthForTests(null);
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('authorization', `Bearer ${'a'.repeat(40)}`);
    expect(res.status).toBe(503);
    __setFirebaseAuthForTests(fake);
  });

  it('requires a well-formed bearer token', async () => {
    __setFirebaseAuthForTests(fake);
    const missing = await request(app).get('/api/v1/users/me');
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe('TOKEN_MISSING');
    const junk = await request(app).get('/api/v1/users/me').set('authorization', 'Bearer not a token');
    expect(junk.body.code).toBe('TOKEN_MISSING');
    const invalid = await request(app)
      .get('/api/v1/users/me')
      .set('authorization', `Bearer ${'b'.repeat(40)}`);
    expect(invalid.status).toBe(401);
    expect(invalid.body.code).toBe('TOKEN_INVALID');
  });

  it('maps expired and revoked tokens', async () => {
    const expired = fake.issue('u-exp', { exp: Math.floor(Date.now() / 1000) - 10 });
    const r1 = await request(app).post('/api/v1/auth/session').set('authorization', `Bearer ${expired}`).send({});
    expect(r1.body.code).toBe('TOKEN_EXPIRED');
    const t = fake.issue('u-rev');
    fake.revoked.add('u-rev');
    const r2 = await request(app).post('/api/v1/auth/session').set('authorization', `Bearer ${t}`).send({});
    expect(r2.body.code).toBe('TOKEN_REVOKED');
  });

  it('validates input before touching the database', async () => {
    const res = await request(app).get('/api/v1/search?q=');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e) => e.field)).toContain('query.q');
    const half = await request(app).get('/api/v1/categories/cleaning?lat=28.4');
    expect(half.status).toBe(422);
    const extra = await request(app).post('/api/v1/auth/session').send({ role: 'admin' });
    expect(extra.status).toBe(422);
  });

  it('partner lists need a signed-in user', async () => {
    const res = await request(app).get('/api/v1/providers?lat=28.4&lng=77.1');
    expect(res.status).toBe(401);
  });

  it('bookings, payments, job offers and notifications are behind auth', async () => {
    for (const path of [
      '/api/v1/bookings',
      '/api/v1/payments/methods',
      '/api/v1/job-offers',
      '/api/v1/notifications',
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it('the wallet is gone (owner decision)', async () => {
    const res = await request(app).post('/api/v1/payments/wallet/add').send({ amount: 100 });
    expect(res.status).toBe(410);
    const w = await request(app).post('/api/v1/providers/withdraw').send({ amount: 100 });
    expect(w.status).toBe(410);
  });

  it('CORS allows mobile apps (no Origin) and blocks unknown browser origins', async () => {
    const mobile = await request(app).get('/api/v1/config');
    expect(mobile.status).toBe(200);
    const browser = await request(app).get('/api/v1/config').set('origin', 'https://evil.example');
    expect(browser.headers['access-control-allow-origin']).toBeUndefined();
  });
});

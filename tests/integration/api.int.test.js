/**
 * End-to-end API tests against a real Postgres + PostGIS + PostgREST loaded
 * with the v2 migrations and seed. Skipped unless TEST_POSTGREST_URL and
 * TEST_SERVICE_ROLE_JWT are set (CI sets them; see scripts/integration-env.sh).
 * Each run uses fresh random user ids, so it can run against the same DB again.
 */
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationConfig, startRestProxy } from '../helpers/postgrest.js';
import { makeFakeAuth } from '../helpers/fakeFirebase.js';

const cfg = integrationConfig();
const run = cfg ? describe : describe.skip;

run('API v2 against a real database', () => {
  let app;
  let proxy;
  let fake;
  let io;
  const tag = crypto.randomBytes(3).toString('hex');
  const uid = (name) => `it_${tag}_${name}`;
  const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;
  const auth = (token) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    proxy = await startRestProxy(cfg.url);
    process.env.SUPABASE_URL = proxy.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = cfg.key;
    const [{ createApp }, firebase] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/config/firebase.js'),
    ]);
    fake = makeFakeAuth();
    firebase.__setFirebaseAuthForTests(fake);
    app = createApp();
    io = await import('socket.io-client');
  });

  afterAll(() => new Promise((r) => proxy.server.close(r)));

  describe('sessions', () => {
    it('creates the account on first sign-in and normalises the phone', async () => {
      const p = phone();
      const t = fake.issue(uid('cust'), { phone_number: `+91${p}`, firebase: { sign_in_provider: 'phone' } });
      const first = await request(app).post('/api/v1/auth/session').set(auth(t)).send({});
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ isNewUser: true, user: { id: uid('cust'), phone: p, role: 'seeker' } });
      const again = await request(app).post('/api/v1/auth/session').set(auth(t)).send({});
      expect(again.body.data.isNewUser).toBe(true); // still no name -> profile onboarding
    });

    it('keeps the v1 body-token aliases working', async () => {
      const t = fake.issue(uid('legacy'), {
        email: `legacy_${tag}@example.com`,
        email_verified: true,
        name: 'Legacy User',
      });
      const res = await request(app).post('/api/v1/auth/google').send({ idToken: t });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        isNewUser: true,
        user: { name: 'Legacy User', email: `legacy_${tag}@example.com` },
      });
      const second = await request(app).post('/api/v1/auth/verify-email').send({ idToken: t });
      expect(second.body.data.isNewUser).toBe(false);
    });

    it('starts a partner profile when signing in from the partner app', async () => {
      const t = fake.issue(uid('partner'), { name: 'New Partner' });
      const res = await request(app).post('/api/v1/auth/session').set(auth(t)).send({ role: 'partner' });
      expect(res.body.data.user).toMatchObject({ role: 'provider', isPartner: true, kycStatus: 'not_started' });
    });

    it('refuses a phone number that belongs to another account', async () => {
      const p = phone();
      await request(app)
        .post('/api/v1/auth/session')
        .set(auth(fake.issue(uid('owner'), { phone_number: `+91${p}` })))
        .send({});
      const res = await request(app)
        .post('/api/v1/auth/session')
        .set(auth(fake.issue(uid('thief'), { phone_number: `+91${p}` })))
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACCOUNT_CONFLICT');
    });

    it('logout revokes the session', async () => {
      const t = fake.issue(uid('logout'), { name: 'Bye Bye' });
      await request(app).post('/api/v1/auth/session').set(auth(t)).send({});
      expect((await request(app).post('/api/v1/auth/logout').set(auth(t))).status).toBe(200);
      const after = await request(app).get('/api/v1/users/me').set(auth(t));
      expect(after.body.code).toBe('TOKEN_REVOKED');
    });
  });

  describe('profile and addresses', () => {
    let t;
    let other;
    beforeAll(async () => {
      t = fake.issue(uid('me'), { phone_number: `+91${phone()}` });
      other = fake.issue(uid('other'), { phone_number: `+91${phone()}` });
      await request(app).post('/api/v1/auth/session').set(auth(t)).send({});
      await request(app).post('/api/v1/auth/session').set(auth(other)).send({});
    });

    it('requires a session row before other endpoints', async () => {
      const ghost = fake.issue(uid('ghost'));
      const res = await request(app).get('/api/v1/users/me').set(auth(ghost));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('updates the profile with validation', async () => {
      const bad = await request(app).patch('/api/v1/users/me').set(auth(t)).send({ name: 'A', isAdmin: true });
      expect(bad.status).toBe(422);
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set(auth(t))
        .send({ name: 'Ayush Test', city: 'Gurugram' });
      expect(res.body.data).toMatchObject({ name: 'Ayush Test', city: 'Gurugram', isAdmin: false });
      const legacy = await request(app).patch('/api/v1/users/profile').set(auth(t)).send({ name: 'Ayush J' });
      expect(legacy.body.data.name).toBe('Ayush J');
    });

    it('address book: first is default, default switches, owner-only access', async () => {
      const home = await request(app).post('/api/v1/users/addresses').set(auth(t)).send({
        label: 'Home',
        line1: 'B-120, Sector 56',
        city: 'Gurugram',
        pincode: '122011',
        lat: 28.4231,
        lng: 77.1036,
      });
      expect(home.status).toBe(201);
      expect(home.body.data).toMatchObject({ label: 'Home', isDefault: true, lat: 28.4231, lng: 77.1036 });

      const work = await request(app).post('/api/v1/users/addresses').set(auth(t)).send({
        label: 'work',
        line1: 'Tower 10, Cyber City',
        city: 'Gurugram',
        pincode: '122002',
        lat: 28.495,
        lng: 77.0895,
        isDefault: true,
      });
      expect(work.body.data.isDefault).toBe(true);

      const list = await request(app).get('/api/v1/users/addresses').set(auth(t));
      expect(list.body.data.map((a) => [a.label, a.isDefault])).toEqual([
        ['Work', true],
        ['Home', false],
      ]);

      const peek = await request(app)
        .patch(`/api/v1/users/addresses/${home.body.data.id}`)
        .set(auth(other))
        .send({ line2: 'x' });
      expect(peek.status).toBe(404);
      const del = await request(app).delete(`/api/v1/users/addresses/${home.body.data.id}`).set(auth(other));
      expect(del.status).toBe(404);

      const badPin = await request(app)
        .post('/api/v1/users/addresses')
        .set(auth(t))
        .send({ line1: 'Somewhere', city: 'Gurugram', pincode: '012345', lat: 1, lng: 1 });
      expect(badPin.status).toBe(422);

      expect((await request(app).delete(`/api/v1/users/addresses/${work.body.data.id}`).set(auth(t))).status).toBe(204);
      const after = await request(app).get('/api/v1/users/addresses').set(auth(t));
      expect(after.body.data).toHaveLength(1);
      expect(after.body.data[0].isDefault).toBe(true); // Home promoted
    });

    it('account deletion anonymises and blocks the account', async () => {
      const t2 = fake.issue(uid('leaver'), { phone_number: `+91${phone()}`, name: 'Leaving Soon' });
      await request(app).post('/api/v1/auth/session').set(auth(t2)).send({});
      expect((await request(app).delete('/api/v1/users/me').set(auth(t2))).status).toBe(204);
      fake.revoked.delete(uid('leaver'));
      const t3 = fake.issue(uid('leaver'));
      const res = await request(app).get('/api/v1/users/me').set(auth(t3));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('catalogue', () => {
    it('lists categories in display order', async () => {
      const res = await request(app).get('/api/v1/categories');
      expect(res.body.data).toHaveLength(10);
      expect(res.body.data[0]).toMatchObject({ slug: 'cleaning', group: 'Home Care', icon: 'cleaning' });
      expect(res.headers['cache-control']).toContain('max-age');
      const legacy = await request(app).get('/api/v1/services/categories');
      expect(legacy.body.data).toHaveLength(10);
    });

    it('category detail includes its services', async () => {
      const res = await request(app).get('/api/v1/categories/cleaning');
      expect(res.body.data.services.map((s) => s.slug)).toEqual(
        expect.arrayContaining(['home-clean', 'bath-clean', 'kitchen-clean', 'sofa-clean']),
      );
      expect((await request(app).get('/api/v1/categories/not-a-thing')).status).toBe(404);
    });

    it('service detail has packages and extras', async () => {
      const res = await request(app).get('/api/v1/services/home-clean');
      const s = res.body.data;
      expect(s).toMatchObject({ name: 'Home Cleaning', priceFrom: 299, categorySlug: 'cleaning' });
      expect(s.packages.map((p) => p.name)).toEqual(['Basic', 'Standard', 'Premium']);
      expect(s.packages[1].popular).toBe(true);
      expect(s.extras).toHaveLength(5);
      const byId = await request(app).get(`/api/v1/services/${s.id}`);
      expect(byId.body.data.slug).toBe('home-clean');
    });

    it('searches and filters services safely', async () => {
      const q = await request(app).get('/api/v1/services?q=clean&limit=50');
      expect(q.body.data.length).toBeGreaterThanOrEqual(4);
      expect(q.body.meta.total).toBe(q.body.data.length);
      const cat = await request(app).get('/api/v1/services?category=salon&sort=price_asc');
      expect(cat.body.data.map((s) => s.slug)).toEqual(['hair', 'facial']);
      const nasty = await request(app).get(`/api/v1/services?q=${encodeURIComponent('%),id.eq.1,(name.ilike.*')}`);
      expect(nasty.status).toBe(200);
      expect(nasty.body.data).toEqual([]);
    });

    it('lists active offers', async () => {
      const res = await request(app).get('/api/v1/offers');
      expect(res.body.data.map((o) => o.code).sort()).toEqual(['CLEAN20', 'FESTIVE100', 'PEST30', 'SERWISH50']);
      expect(res.body.data.find((o) => o.code === 'PEST30').categorySlug).toBe('pest-control');
    });
  });

  describe('partners', () => {
    const near = '/api/v1/providers?lat=28.4231&lng=77.1036';
    let viewer;
    const get = (path) => request(app).get(path).set(auth(viewer));
    beforeAll(async () => {
      viewer = fake.issue(uid('viewer'), { name: 'Partner Browser' });
      await request(app).post('/api/v1/auth/session').set(auth(viewer)).send({});
    });

    it('requires a signed-in user (no anonymous scraping)', async () => {
      expect((await request(app).get(near)).status).toBe(401);
      expect((await request(app).get('/api/v1/providers/seed_ravi')).status).toBe(401);
    });

    it('lists approved partners within 5 km, nearest first', async () => {
      const res = await get(near);
      const d = res.body.data.map((p) => p.distanceKm);
      expect(d.length).toBeGreaterThan(3);
      expect(d.every((x) => x <= 5)).toBe(true);
      expect([...d].sort((a, b) => a - b)).toEqual(d);
      expect(res.body.meta.radiusKm).toBe(5);
    });

    it('filters by category, service and online state; sorts by rating', async () => {
      const salon = await get(`${near}&category=salon`);
      expect(salon.body.data.map((p) => p.id)).toEqual(['seed_priya']);
      const svc = (await get('/api/v1/services/ac')).body.data;
      const ac = await get(`${near}&serviceId=${svc.id}`);
      expect(ac.body.data.map((p) => p.id)).toEqual(['seed_sunil']);
      const online = await get(`${near}&radiusKm=10&category=cleaning&onlineOnly=true`);
      expect(online.body.data.every((p) => p.online)).toBe(true);
      expect(online.body.data.map((p) => p.id)).not.toContain('seed_deepak');
      const rated = await get(`${near}&radiusKm=10&sort=rating`);
      expect(rated.body.data[0].id).toBe('seed_priya');
    });

    it('caps the radius at twice the matching radius', async () => {
      const res = await get(`${near}&radiusKm=25`);
      expect(res.body.meta.radiusKm).toBe(10);
    });

    it('profile detail is public but never exposes KYC data', async () => {
      const res = await get('/api/v1/providers/seed_ravi');
      expect(res.body.data).toMatchObject({
        id: 'seed_ravi',
        name: 'Ravi Kumar',
        title: 'Home Cleaning Expert',
        verified: true,
        categorySlugs: ['cleaning'],
      });
      expect(res.body.data.serviceIds.length).toBe(4);
      expect(res.body.data.areas).toContain('Sector 56');
      expect(JSON.stringify(res.body)).not.toMatch(/kyc_|doc_path|seed\/seed_ravi/);
      const reviews = await get('/api/v1/providers/seed_ravi/reviews');
      expect(reviews.body).toMatchObject({ data: [], meta: { total: 0 } });
    });

    it('hides partners that are not approved', async () => {
      const t = fake.issue(uid('pending'), { name: 'Pending Partner' });
      await request(app).post('/api/v1/auth/session').set(auth(t)).send({ role: 'partner' });
      expect((await get(`/api/v1/providers/${uid('pending')}`)).status).toBe(404);
      expect((await get('/api/v1/providers/../../etc')).status).toBe(404);
    });

    it('the old one-shot KYC upload is gone; customers cannot use partner tools', async () => {
      const t = fake.issue(uid('partner'));
      const kyc = await request(app).post('/api/v1/providers/kyc').set(auth(t));
      expect(kyc.status).toBe(410);
      expect(kyc.body.code).toBe('GONE');
      const cust = fake.issue(uid('me'));
      expect((await request(app).get('/api/v1/providers/me').set(auth(cust))).body.code).toBe('PARTNER_ONLY');
    });

    it('profile detail embeds the 5 latest reviews', async () => {
      const res = await get('/api/v1/providers/seed_ravi');
      expect(Array.isArray(res.body.data.latestReviews)).toBe(true);
    });
  });

  describe('realtime', () => {
    let server;
    let url;
    beforeAll(async () => {
      const { createServer } = await import('node:http');
      const { initSocket } = await import('../../src/socket/index.js');
      server = createServer();
      initSocket(server);
      await new Promise((r) => server.listen(0, r));
      url = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    const open = (token) =>
      new Promise((resolve, reject) => {
        const c = io.io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
        c.on('connect', () => resolve(c));
        c.on('connect_error', reject);
      });
    const ask = (c, event, payload) => new Promise((r) => c.emit(event, payload, r));

    it('an approved partner can go online and stream location', async () => {
      const t = fake.issue('seed_neha');
      const c = await open(t);
      const on = await ask(c, 'partner:online', { lat: 28.43, lng: 77.11 });
      expect(on).toEqual({ ok: true, data: { online: true } });
      expect((await ask(c, 'partner:location', { lat: 28.431, lng: 77.111 })).ok).toBe(true);
      expect((await ask(c, 'partner:location', { lat: 'x' })).code).toBe('VALIDATION_FAILED');
      expect((await ask(c, 'partner:offline', {})).data).toEqual({ online: false });
      expect((await ask(c, 'partner:online', { lat: 28.43, lng: 77.11 })).ok).toBe(true); // restore seed state
      c.close();
    });

    it('a partner without approved KYC cannot go online', async () => {
      const c = await open(fake.issue(uid('pending')));
      const res = await ask(c, 'partner:online', { lat: 28.43, lng: 77.11 });
      expect(res).toMatchObject({ ok: false, code: 'KYC_NOT_APPROVED' });
      c.close();
    });

    it('customers cannot use partner events or watch other bookings', async () => {
      const c = await open(fake.issue(uid('me')));
      const none = await Promise.race([
        ask(c, 'partner:online', { lat: 1, lng: 1 }),
        new Promise((r) => setTimeout(() => r('no handler'), 300)),
      ]);
      expect(none).toBe('no handler');
      const watch = await ask(c, 'booking:watch', { bookingId: crypto.randomUUID() });
      expect(watch).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      c.close();
    });
  });
});

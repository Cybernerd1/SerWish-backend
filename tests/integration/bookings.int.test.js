/**
 * Backend Phase 2 + 3 end to end: partner registration, catalogue search,
 * pricing, booking creation, dispatcher offers over sockets, partner moves,
 * completion after payment, cancellation, reviews and notifications.
 * Runs against a real Postgres + PostGIS + PostgREST (see api.int.test.js).
 * Test partners live at a random spot near Kochi so the Gurugram seed data
 * never interferes, and they are set offline afterwards.
 */
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationConfig, startRestProxy } from '../helpers/postgrest.js';
import { makeFakeAuth } from '../helpers/fakeFirebase.js';

const cfg = integrationConfig();
const run = cfg ? describe : describe.skip;

run('Phase 2 + 3 against a real database', () => {
  let app;
  let proxy;
  let fake;
  let db;
  let runTick;
  let ioClient;
  let socketServer;
  let socketUrl;
  const sockets = [];

  const tag = crypto.randomBytes(3).toString('hex');
  const uid = (name) => `bk_${tag}_${name}`;
  const auth = (t) => ({ authorization: `Bearer ${t}` });
  const key = () => `test-${crypto.randomUUID()}`;
  // Random base point around Kochi, far from the Gurugram seed partners.
  const base = { lat: 9.9 + Math.random() * 0.2, lng: 76.2 + Math.random() * 0.2 };
  const at = (km) => ({ lat: base.lat + km / 111, lng: base.lng });

  const tokens = {};
  const svc = {};
  let addressId;

  const session = async (name, claims = {}) => {
    tokens[name] = fake.issue(uid(name), { name: claims.name ?? `Test ${name}`, ...claims });
    const res = await request(app).post('/api/v1/auth/session').set(auth(tokens[name])).send({});
    expect(res.status).toBe(200);
    return tokens[name];
  };

  /** Register a partner through the API, then approve KYC and put them online (admin tools come in Phase 6). */
  const makePartner = async (name, km, categorySlugs) => {
    const t = await session(name);
    const res = await request(app)
      .post('/api/v1/providers/register')
      .set(auth(t))
      .send({ name: `Partner ${name}`, categorySlugs, title: `${categorySlugs[0]} pro`, years: 3 });
    expect(res.status).toBe(201);
    const p = at(km);
    const { error } = await db()
      .from('provider_profiles')
      .update({
        kyc_status: 'approved',
        kyc_id_doc_path: `test/${uid(name)}/id.jpg`,
        kyc_cert_doc_path: `test/${uid(name)}/cert.jpg`,
        is_online: true,
        current_location: `SRID=4326;POINT(${p.lng} ${p.lat})`,
      })
      .eq('user_id', uid(name));
    expect(error).toBeNull();
    return t;
  };

  const openSocket = (token) =>
    new Promise((resolve, reject) => {
      const c = ioClient.io(socketUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
      const inbox = [];
      c.onAny((event, payload) => inbox.push({ event, payload }));
      c.on('connect', () => {
        sockets.push(c);
        resolve({ c, inbox });
      });
      c.on('connect_error', reject);
    });
  const ask = (c, event, payload) => new Promise((r) => c.emit(event, payload, r));
  const waitFor = async (inbox, event, pred = () => true, ms = 3000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const hit = inbox.find((m) => m.event === event && pred(m.payload));
      if (hit) return hit.payload;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for ${event}`);
  };

  const book = (t, body, k = key()) =>
    request(app)
      .post('/api/v1/bookings')
      .set(auth(t))
      .set('idempotency-key', k)
      .send({ serviceId: svc.homeClean.id, addressId, paymentMethod: 'cash', ...body });

  const openOfferFor = async (name, bookingId) => {
    const res = await request(app).get('/api/v1/job-offers').set(auth(tokens[name]));
    return res.body.data.find((o) => o.bookingId === bookingId) ?? null;
  };

  beforeAll(async () => {
    proxy = await startRestProxy(cfg.url);
    process.env.SUPABASE_URL = proxy.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = cfg.key;
    const [{ createApp }, firebase, supa, dispatcher, socket] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/config/firebase.js'),
      import('../../src/config/supabase.js'),
      import('../../src/services/dispatcher.js'),
      import('../../src/socket/index.js'),
    ]);
    fake = makeFakeAuth();
    firebase.__setFirebaseAuthForTests(fake);
    db = supa.db;
    runTick = dispatcher.runTick;
    app = createApp();
    ioClient = await import('socket.io-client');
    socketServer = createServer();
    socket.initSocket(socketServer);
    await new Promise((r) => socketServer.listen(0, r));
    socketUrl = `http://127.0.0.1:${socketServer.address().port}`;

    for (const slug of ['home-clean', 'car', 'hair']) {
      svc[slug === 'home-clean' ? 'homeClean' : slug] = (await request(app).get(`/api/v1/services/${slug}`)).body.data;
    }

    await session('cust', { phone_number: `+919${crypto.randomInt(100000000, 999999999)}` });
    await session('other');
    const addr = await request(app)
      .post('/api/v1/users/addresses')
      .set(auth(tokens.cust))
      .send({ label: 'Home', line1: '12A, Marine Drive', city: 'Kochi', pincode: '682031', ...base });
    expect(addr.status).toBe(201);
    addressId = addr.body.data.id;

    await makePartner('near', 1, ['cleaning']);
    await makePartner('far', 3, ['cleaning', 'pest-control']);
    await makePartner('salon', 0.5, ['salon']);
  });

  afterAll(async () => {
    for (const c of sockets) c.close();
    await db()
      .from('provider_profiles')
      .update({ is_online: false })
      .in('user_id', [uid('near'), uid('far'), uid('salon')]);
    await new Promise((r) => socketServer.close(r));
    await new Promise((r) => proxy.server.close(r));
  });

  /* ---------------- Phase 2 ---------------- */

  describe('partner registration and profile', () => {
    it('validates categories and never re-registers an approved partner', async () => {
      const t = await session('newbie');
      const bad = await request(app)
        .post('/api/v1/providers/register')
        .set(auth(t))
        .send({ name: 'New Bie', categorySlugs: ['not-a-category'] });
      expect(bad.status).toBe(422);
      const ok = await request(app)
        .post('/api/v1/providers/register')
        .set(auth(t))
        .send({ name: 'New Bie', categorySlugs: ['plumbing', 'electrician'], city: 'Kochi' });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ name: 'New Bie', kyc: { status: 'not_started' }, canGoOnline: false });
      expect(ok.body.data.categories.map((c) => c.slug).sort()).toEqual(['electrician', 'plumbing']);
      const again = await request(app)
        .post('/api/v1/providers/register')
        .set(auth(tokens.near))
        .send({ name: 'Partner near', categorySlugs: ['cleaning'] });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_PARTNER');
      // The partner keeps the customer side of the account.
      expect((await request(app).get('/api/v1/users/me').set(auth(t))).body.data).toMatchObject({
        isPartner: true,
        name: 'New Bie',
      });
    });

    it('reads and edits the own partner profile without exposing KYC files', async () => {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set(auth(tokens.near))
        .send({
          bio: 'Ten years of spotless homes.',
          languages: ['Malayalam', 'English'],
          areas: ['Marine Drive'],
          pricePerHour: 299,
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        bio: 'Ten years of spotless homes.',
        pricePerHour: 299,
        kyc: { status: 'approved' },
        canGoOnline: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/doc_path|test\/bk_/);
      const bad = await request(app)
        .patch('/api/v1/providers/me')
        .set(auth(tokens.near))
        .send({ kycStatus: 'approved' });
      expect(bad.status).toBe(422);
    });
  });

  describe('catalogue extras', () => {
    it('category tiles show the lowest price', async () => {
      const res = await request(app).get('/api/v1/categories');
      expect(res.body.data.find((c) => c.slug === 'cleaning').priceFrom).toBe(299);
      expect(res.body.data.find((c) => c.slug === 'painting').priceFrom).toBe(1999);
    });

    it('category detail adds top partners near a location', async () => {
      const res = await request(app).get(`/api/v1/categories/cleaning?lat=${base.lat}&lng=${base.lng}`);
      expect(res.body.data.services.length).toBeGreaterThan(0);
      expect(res.body.data.topProviders.map((p) => p.id)).toEqual(expect.arrayContaining([uid('near'), uid('far')]));
      expect(res.body.data.topProviders.length).toBeLessThanOrEqual(5);
    });

    it('search, autocomplete and popular services', async () => {
      const s = await request(app).get('/api/v1/search?q=clean');
      expect(s.body.data.categories.map((c) => c.slug)).toContain('cleaning');
      expect(s.body.data.services.length).toBeGreaterThan(2);
      const sug = await request(app).get('/api/v1/search/suggest?q=ac');
      expect(sug.body.data.some((i) => i.type === 'service' && i.slug === 'ac')).toBe(true);
      expect(sug.body.data.length).toBeLessThanOrEqual(8);
      const pop = await request(app).get('/api/v1/services/popular?limit=3');
      expect(pop.body.data).toHaveLength(3);
      expect(pop.body.data[0].slug).toBe('ac'); // most reviewed in the seed
    });
  });

  /* ---------------- Phase 3 ---------------- */

  describe('pricing', () => {
    it('estimate adds the package and add-ons and applies a coupon', async () => {
      const std = svc.homeClean.packages.find((p) => p.name === 'Standard');
      const extras = svc.homeClean.extras.slice(0, 2);
      const res = await request(app)
        .post('/api/v1/bookings/estimate')
        .set(auth(tokens.cust))
        .send({
          serviceId: svc.homeClean.id,
          packageId: std.id,
          extraIds: extras.map((x) => x.id),
          couponCode: 'clean20',
        });
      const subtotal = std.price + extras[0].price + extras[1].price;
      const discount = Math.floor((subtotal * 20) / 100);
      expect(res.body.data).toMatchObject({
        basePrice: std.price,
        extrasTotal: extras[0].price + extras[1].price,
        subtotal,
        discount,
        platformFee: 0,
        total: subtotal - discount,
        coupon: { code: 'CLEAN20', applied: true },
      });
    });

    it('explains coupons that do not apply', async () => {
      const res = await request(app)
        .post('/api/v1/bookings/estimate')
        .set(auth(tokens.cust))
        .send({ serviceId: svc.hair.id, couponCode: 'PEST30' });
      expect(res.body.data.coupon).toMatchObject({ applied: false, reason: expect.stringMatching(/does not apply/) });
      const bad = await request(app)
        .post('/api/v1/bookings/estimate')
        .set(auth(tokens.cust))
        .send({ serviceId: svc.homeClean.id, extraIds: [svc.hair.packages[0].id] });
      expect(bad.status).toBe(400);
    });
  });

  describe('booking lifecycle', () => {
    let bookingId;

    it('needs an idempotency key, refuses card for now and checks the slot', async () => {
      const noKey = await request(app)
        .post('/api/v1/bookings')
        .set(auth(tokens.cust))
        .send({ serviceId: svc.homeClean.id, addressId });
      expect(noKey.status).toBe(400);
      const card = await book(tokens.cust, { paymentMethod: 'card' });
      expect(card.status).toBe(422);
      const soon = await book(tokens.cust, {
        scheduleType: 'later',
        scheduledAt: new Date(Date.now() + 10 * 60000).toISOString(),
      });
      expect(soon.status).toBe(422);
      const stale = await book(tokens.cust, { expectedTotal: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('PRICE_CHANGED');
      expect(stale.body.data.estimate.total).toBe(299);
      const otherAddr = await book(tokens.other, {});
      expect(otherAddr.status).toBe(404); // not their address
    });

    it('creates once per key, with the server price and the address snapshot', async () => {
      const k = key();
      const res = await book(tokens.cust, { couponCode: 'SERWISH50', notes: 'Gate code 1234', expectedTotal: 150 }, k);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'searching',
        appStatus: 'ongoing',
        price: { base: 299, discount: 149, fee: 0, total: 150 },
        couponCode: 'SERWISH50',
        address: { text: '12A, Marine Drive, Kochi 682031' },
        notes: 'Gate code 1234',
        provider: null,
      });
      bookingId = res.body.data.id;
      const again = await book(tokens.cust, { couponCode: 'SERWISH50' }, k);
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(bookingId);
    });

    it('offers the job to the nearest partner first, over the socket', async () => {
      const near = await openSocket(tokens.near);
      const far = await openSocket(tokens.far);
      await runTick();
      const offer = await waitFor(near.inbox, 'job:offer', (p) => p.bookingId === bookingId);
      expect(offer).toMatchObject({ serviceName: 'Home Cleaning', payout: 150, area: 'Marine Drive, Kochi 682031' });
      expect(offer.area).not.toContain('12A');
      expect(Date.parse(offer.expiresAt) - Date.parse(offer.offeredAt)).toBeGreaterThanOrEqual(44000);
      expect(far.inbox.some((m) => m.event === 'job:offer' && m.payload.bookingId === bookingId)).toBe(false);
      expect(await openOfferFor('salon', bookingId)).toBeNull();
      // Only the offered partner can act on it.
      expect((await request(app).post(`/api/v1/job-offers/${offer.id}/accept`).set(auth(tokens.far))).status).toBe(404);
    });

    it('declining moves the offer to the next partner, who accepts', async () => {
      const offer = await openOfferFor('near', bookingId);
      const rej = await request(app).post(`/api/v1/job-offers/${offer.id}/reject`).set(auth(tokens.near));
      expect(rej.status).toBe(200);
      await runTick();
      const next = await openOfferFor('far', bookingId);
      expect(next).not.toBeNull();
      const cust = await openSocket(tokens.cust);
      const acc = await request(app).post(`/api/v1/job-offers/${next.id}/accept`).set(auth(tokens.far));
      expect(acc.status).toBe(200);
      expect(acc.body.data).toMatchObject({ status: 'assigned', payout: 150, customer: { name: 'Test cust' } });
      const update = await waitFor(cust.inbox, 'booking:updated', (b) => b.id === bookingId && b.status === 'assigned');
      expect(update.provider.id).toBe(uid('far'));
      // Offers cannot be accepted twice.
      expect((await request(app).post(`/api/v1/job-offers/${next.id}/accept`).set(auth(tokens.far))).status).toBe(409);
    });

    it('a partner holding a job cannot go offline', async () => {
      const far = sockets.find(() => true) && (await openSocket(tokens.far));
      const res = await ask(far.c, 'partner:offline', {});
      expect(res).toMatchObject({ ok: false, code: 'ACTIVE_JOB' });
    });

    it('moves forward in order only, by the assigned partner only', async () => {
      const early = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(tokens.far))
        .send({ method: 'cash', amountReceived: 150 });
      expect(early.status).toBe(409);
      expect((await request(app).post(`/api/v1/bookings/${bookingId}/start-trip`).set(auth(tokens.near))).status).toBe(
        404,
      );
      expect((await request(app).post(`/api/v1/bookings/${bookingId}/start`).set(auth(tokens.far))).status).toBe(409);
      for (const [step, status] of [
        ['start-trip', 'en_route'],
        ['arrive', 'arrived'],
        ['start', 'in_progress'],
      ]) {
        const res = await request(app).post(`/api/v1/bookings/${bookingId}/${step}`).set(auth(tokens.far));
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(status);
      }
      const cancel = await request(app)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set(auth(tokens.cust))
        .send({ reason: 'Too late' });
      expect(cancel.status).toBe(409);
    });

    it('completes only with the full amount received, and records it once', async () => {
      const short = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(tokens.far))
        .send({ method: 'cash', amountReceived: 100 });
      expect(short.status).toBe(409);
      const done = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(tokens.far))
        .send({ method: 'upi', amountReceived: 150 });
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({
        status: 'completed',
        appStatus: 'completed',
        paid: true,
        paymentMethod: 'upi',
      });
      expect(done.body.data.timeline.every((s) => s.done)).toBe(true);
      const retry = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(tokens.far))
        .send({ method: 'upi', amountReceived: 150 });
      expect(retry.status).toBe(200);
      const { data: pays } = await db().from('payments').select('id').eq('booking_id', bookingId);
      expect(pays).toHaveLength(1);
      const { data: earn } = await db().from('provider_earnings').select('amount').eq('booking_id', bookingId);
      expect(earn).toEqual([{ amount: 150 }]);
    });

    it('the first-booking coupon is gone after a completed booking', async () => {
      const res = await request(app)
        .post('/api/v1/bookings/estimate')
        .set(auth(tokens.cust))
        .send({ serviceId: svc.homeClean.id, couponCode: 'SERWISH50' });
      expect(res.body.data.coupon).toMatchObject({ applied: false, reason: expect.stringMatching(/first booking/) });
    });

    it('one optional review per completed booking updates the partner rating', async () => {
      const r = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set(auth(tokens.cust))
        .send({ rating: 5, text: 'Spotless!', tags: ['On time'] });
      expect(r.status).toBe(201);
      const dup = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set(auth(tokens.cust))
        .send({ rating: 1 });
      expect(dup.body.code).toBe('ALREADY_REVIEWED');
      const byPartner = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set(auth(tokens.far))
        .send({ rating: 5 });
      expect(byPartner.status).toBe(404);
      const pro = await request(app)
        .get(`/api/v1/providers/${uid('far')}`)
        .set(auth(tokens.cust));
      expect(pro.body.data).toMatchObject({ rating: 5, reviewCount: 1, jobs: 1, ratingBreakdown: [100, 0, 0, 0, 0] });
      expect(pro.body.data.latestReviews[0]).toMatchObject({ rating: 5, text: 'Spotless!', service: 'Home Cleaning' });
    });

    it('lists are scoped and filtered; strangers get 404', async () => {
      const mine = await request(app).get('/api/v1/bookings?status=completed').set(auth(tokens.cust));
      expect(mine.body.data.map((b) => b.id)).toContain(bookingId);
      expect(mine.body.data.find((b) => b.id === bookingId).review.rating).toBe(5);
      const jobs = await request(app).get('/api/v1/bookings?as=partner').set(auth(tokens.far));
      expect(jobs.body.data.map((b) => b.id)).toContain(bookingId);
      const notPartner = await request(app).get('/api/v1/bookings?as=partner').set(auth(tokens.other));
      expect(notPartner.status).toBe(403);
      expect((await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth(tokens.other))).status).toBe(404);
      expect((await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth(tokens.near))).status).toBe(404);
    });
  });

  describe('cancellations and timeouts', () => {
    it('a partner dropping out re-dispatches to someone else', async () => {
      const res = await book(tokens.cust, {});
      const id = res.body.data.id;
      await runTick();
      const offer = await openOfferFor('near', id);
      await request(app).post(`/api/v1/job-offers/${offer.id}/accept`).set(auth(tokens.near)).expect(200);
      await request(app).post(`/api/v1/bookings/${id}/start-trip`).set(auth(tokens.near)).expect(200);
      const drop = await request(app)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(auth(tokens.near))
        .send({ reason: 'Flat tyre' });
      expect(drop.body.data).toMatchObject({ id, status: 'released' });
      const after = await request(app).get(`/api/v1/bookings/${id}`).set(auth(tokens.cust));
      expect(after.body.data).toMatchObject({ status: 'searching', provider: null });
      await runTick();
      expect(await openOfferFor('far', id)).not.toBeNull();
      expect(await openOfferFor('near', id)).toBeNull();
      // Customer cancels while searching: the open offer closes too.
      const cancel = await request(app)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(auth(tokens.cust))
        .send({ reason: 'Change in plans' });
      expect(cancel.body.data).toMatchObject({
        status: 'cancelled',
        appStatus: 'cancelled',
        cancelledBy: 'customer',
        cancelReason: 'Change in plans',
      });
      expect(await openOfferFor('far', id)).toBeNull();
    });

    it('ends the search with no_providers after the matching timeout', async () => {
      const res = await book(tokens.cust, { serviceId: svc.car.id });
      const id = res.body.data.id;
      await runTick();
      expect((await request(app).get(`/api/v1/bookings/${id}`).set(auth(tokens.cust))).body.data.status).toBe(
        'searching',
      );
      await db()
        .from('bookings')
        .update({ dispatch_started_at: new Date(Date.now() - 3600_000).toISOString() })
        .eq('id', id);
      await runTick();
      const after = await request(app).get(`/api/v1/bookings/${id}`).set(auth(tokens.cust));
      expect(after.body.data).toMatchObject({ status: 'no_providers', appStatus: 'cancelled' });
    });

    it('scheduled bookings wait until shortly before the slot', async () => {
      const res = await book(tokens.cust, {
        scheduleType: 'later',
        scheduledAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ appStatus: 'upcoming', asap: false });
      await runTick();
      expect(await openOfferFor('near', res.body.data.id)).toBeNull();
      expect(await openOfferFor('far', res.body.data.id)).toBeNull();
    });

    it('limits how many bookings a customer can have open', async () => {
      const t = await session('busy');
      const a = await request(app)
        .post('/api/v1/users/addresses')
        .set(auth(t))
        .send({ line1: 'Somewhere 1', city: 'Kochi', pincode: '682031', ...at(30) });
      const results = [];
      for (let i = 0; i < 4; i += 1) {
        results.push(
          await request(app)
            .post('/api/v1/bookings')
            .set(auth(t))
            .set('idempotency-key', key())
            .send({ serviceId: svc.car.id, addressId: a.body.data.id, paymentMethod: 'cash' }),
        );
      }
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 409]);
      expect(results[3].body.code).toBe('TOO_MANY_ACTIVE');
    });
  });

  describe('reschedule', () => {
    it('moves a booking, releases the assigned partner and waits for the new slot', async () => {
      const res = await book(tokens.cust, {});
      const id = res.body.data.id;
      await runTick();
      const offer = (await openOfferFor('near', id)) ?? (await openOfferFor('far', id));
      const who = offer.bookingId && (await openOfferFor('near', id)) ? 'near' : 'far';
      await request(app).post(`/api/v1/job-offers/${offer.id}/accept`).set(auth(tokens[who])).expect(200);
      const soon = await request(app)
        .post(`/api/v1/bookings/${id}/reschedule`)
        .set(auth(tokens.cust))
        .send({ scheduledAt: new Date(Date.now() + 5 * 60000).toISOString() });
      expect(soon.status).toBe(409);
      const when = new Date(Date.now() + 2 * 86400000).toISOString();
      const ok = await request(app)
        .post(`/api/v1/bookings/${id}/reschedule`)
        .set(auth(tokens.cust))
        .send({ scheduledAt: when });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        status: 'searching',
        scheduleType: 'later',
        appStatus: 'upcoming',
        provider: null,
      });
      expect(Date.parse(ok.body.data.scheduledAt)).toBe(Date.parse(when));
      const byOther = await request(app)
        .post(`/api/v1/bookings/${id}/reschedule`)
        .set(auth(tokens.other))
        .send({ scheduledAt: when });
      expect(byOther.status).toBe(404);
      const partner = await request(app).get('/api/v1/notifications').set(auth(tokens[who]));
      expect(partner.body.data.some((n) => n.title === 'Job rescheduled')).toBe(true);
      await request(app)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(auth(tokens.cust))
        .send({ reason: 'Test cleanup' })
        .expect(200);
    });
  });

  describe('notifications', () => {
    it('the customer got a message for each step, and can mark them read', async () => {
      const res = await request(app).get('/api/v1/notifications').set(auth(tokens.cust));
      const titles = res.body.data.map((n) => n.title);
      for (const t of [
        'Professional assigned',
        'Professional on the way',
        'Service completed',
        'Finding another professional',
        'No professional available',
      ]) {
        expect(titles).toContain(t);
      }
      expect(res.body.meta.unread).toBeGreaterThan(0);
      await request(app).post('/api/v1/notifications/read').set(auth(tokens.cust)).send({}).expect(200);
      const after = await request(app).get('/api/v1/notifications?unread=true').set(auth(tokens.cust));
      expect(after.body.data).toHaveLength(0);
      const partner = await request(app).get('/api/v1/notifications').set(auth(tokens.near));
      expect(partner.body.data.some((n) => n.title === 'New job request' && n.kind === 'job')).toBe(true);
    });
  });
});

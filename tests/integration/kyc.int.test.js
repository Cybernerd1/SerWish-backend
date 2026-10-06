/**
 * Partner verification end to end against the real database, with the fake
 * verification provider and in-memory document storage:
 * consent -> DigiLocker (fake page) -> selfie -> bank -> submit -> admin reject
 * -> fix -> resubmit -> admin approve -> can go online. Plus the manual-ID path,
 * duplicate identities, file checks and access rules.
 */
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationConfig, startRestProxy } from '../helpers/postgrest.js';
import { makeFakeAuth } from '../helpers/fakeFirebase.js';

const cfg = integrationConfig();
const run = cfg ? describe : describe.skip;

const JPEG = (marker = '') =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF test photo ${marker} `.padEnd(64, '.'))]);

run('Partner KYC against a real database', () => {
  let app;
  let proxy;
  let fake;
  let db;
  let storage;
  const tag = crypto.randomBytes(3).toString('hex');
  const uid = (n) => `kyc_${tag}_${n}`;
  const auth = (t) => ({ authorization: `Bearer ${t}` });
  const tokens = {};

  const partner = async (name, fullName) => {
    tokens[name] = fake.issue(uid(name), { name: fullName });
    expect((await request(app).post('/api/v1/auth/session').set(auth(tokens[name])).send({})).status).toBe(200);
    const res = await request(app)
      .post('/api/v1/providers/register')
      .set(auth(tokens[name]))
      .send({ name: fullName, categorySlugs: ['cleaning'], years: 4 });
    expect(res.status).toBe(201);
    return tokens[name];
  };

  const consentAndDigilocker = async (t, allow = true) => {
    const c = await request(app).post('/api/v1/providers/kyc/consent').set(auth(t)).send({ version: 'partner-kyc-v1' });
    expect(c.status).toBe(200);
    const s = await request(app).post('/api/v1/providers/kyc/digilocker/start').set(auth(t)).send({});
    expect(s.status).toBe(200);
    const page = await request(app).get(
      new URL(s.body.data.consentUrl).pathname + new URL(s.body.data.consentUrl).search,
    );
    expect(page.status).toBe(200);
    const decided = await request(app)
      .post('/api/v1/providers/kyc/fake-digilocker')
      .type('form')
      .send({ ref: s.body.data.verificationId, allow: allow ? '1' : '0' });
    expect(decided.status).toBe(303);
    return {
      ref: s.body.data.verificationId,
      complete: () =>
        request(app)
          .post('/api/v1/providers/kyc/digilocker/complete')
          .set(auth(t))
          .send({ verificationId: s.body.data.verificationId }),
    };
  };

  beforeAll(async () => {
    proxy = await startRestProxy(cfg.url);
    process.env.SUPABASE_URL = proxy.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = cfg.key;
    const [{ createApp }, firebase, supa, prov, store] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/config/firebase.js'),
      import('../../src/config/supabase.js'),
      import('../../src/services/kyc/providers/index.js'),
      import('../../src/services/kyc/storage.js'),
    ]);
    fake = makeFakeAuth();
    firebase.__setFirebaseAuthForTests(fake);
    prov.__setKycProviderForTests('fake');
    storage = store.memoryStore();
    store.__setKycStorageForTests(storage);
    db = supa.db;
    app = createApp();

    tokens.admin = fake.issue(uid('admin'), { name: 'Asha Admin' });
    await request(app).post('/api/v1/auth/session').set(auth(tokens.admin)).send({});
    const { error } = await db().from('users').update({ is_admin: true }).eq('id', uid('admin'));
    expect(error).toBeNull();
  });

  afterAll(async () => {
    const prov = await import('../../src/services/kyc/providers/index.js');
    prov.__setKycProviderForTests(null);
    (await import('../../src/services/kyc/storage.js')).__setKycStorageForTests(null);
    await new Promise((r) => proxy.server.close(r));
  });

  it('starts empty and needs consent before any check', async () => {
    const t = await partner('ravi', `Ravi Kumar ${tag}`);
    const k = await request(app).get('/api/v1/providers/me/kyc').set(auth(t));
    expect(k.status).toBe(200);
    expect(k.body.data).toMatchObject({
      status: 'not_started',
      level: 0,
      digilocker: { available: true },
      canSubmit: false,
    });
    const early = await request(app).post('/api/v1/providers/kyc/digilocker/start').set(auth(t)).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('CONSENT_REQUIRED');
    const old = await request(app)
      .post('/api/v1/providers/kyc/consent')
      .set(auth(t))
      .send({ version: 'partner-kyc-v0' });
    expect(old.body.code).toBe('CONSENT_OUTDATED');
  });

  it('full flow: DigiLocker, selfie, bank, submit, reject, fix, approve, go online', async () => {
    const t = tokens.ravi;
    const dl = await consentAndDigilocker(t);
    const done = await dl.complete();
    expect(done.status).toBe(200);
    const id = done.body.data.steps.identity;
    expect(id).toMatchObject({ state: 'done', source: 'digilocker', docType: 'aadhaar' });
    expect(id.aadhaarLast4).toMatch(/^\d{4}$/);
    expect(done.body.data.status).toBe('in_progress');
    expect(done.body.data.level).toBe(1);
    // Completing twice is harmless.
    expect((await dl.complete()).status).toBe(200);

    // Nothing sensitive is stored: last 4 only, no Aadhaar paths beyond the face photo.
    const { data: row } = await db().from('partner_kyc').select('*').eq('partner_id', uid('ravi')).single();
    expect(row.id_aadhaar_last4).toHaveLength(4);
    expect(row.id_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/\d{12}/);

    // Selfie that does not match, then a good one.
    const bad = await request(app)
      .post('/api/v1/providers/kyc/selfie')
      .set(auth(t))
      .attach('photo', JPEG('NOMATCH'), 'selfie.jpg');
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('FACE_MISMATCH');
    expect(bad.body.data.kyc.steps.selfie).toMatchObject({ state: 'failed', attemptsLeft: 2 });
    const good = await request(app)
      .post('/api/v1/providers/kyc/selfie')
      .set(auth(t))
      .attach('photo', JPEG(), 'selfie.jpg');
    expect(good.status).toBe(200);
    expect(good.body.data.steps.selfie.state).toBe('done');

    // Bank: invalid account, then valid.
    const invalid = await request(app)
      .post('/api/v1/providers/kyc/bank')
      .set(auth(t))
      .send({ accountNumber: '000123456789', ifsc: 'SBIN0001234', holderName: `Ravi Kumar ${tag}` });
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe('BANK_INVALID');
    const bank = await request(app)
      .post('/api/v1/providers/kyc/bank')
      .set(auth(t))
      .send({
        accountNumber: `12345${crypto.randomInt(1000000, 9999999)}`,
        ifsc: 'sbin0001234',
        holderName: `Ravi Kumar ${tag}`,
      });
    expect(bank.status).toBe(200);
    expect(bank.body.data.steps.bank).toMatchObject({ state: 'done', ifsc: 'SBIN0001234' });
    expect(bank.body.data.canSubmit).toBe(true);

    const sub = await request(app).post('/api/v1/providers/kyc/submit').set(auth(t)).send({});
    expect(sub.status).toBe(200);
    expect(sub.body.data.status).toBe('pending');
    const locked = await request(app)
      .post('/api/v1/providers/kyc/selfie')
      .set(auth(t))
      .attach('photo', JPEG(), 'selfie.jpg');
    expect(locked.body.code).toBe('KYC_IN_REVIEW');

    // Admin: queue, case, reject the selfie.
    const q = await request(app).get('/api/v1/admin/kyc/queue').set(auth(tokens.admin));
    expect(q.status).toBe(200);
    expect(q.body.data.some((c) => c.partnerId === uid('ravi'))).toBe(true);
    const kase = await request(app)
      .get(`/api/v1/admin/kyc/${uid('ravi')}`)
      .set(auth(tokens.admin));
    expect(kase.status).toBe(200);
    expect(kase.body.data.verified.identity.dob).toBe('1994-05-17');
    expect(kase.body.data.documents.selfie).toMatch(/^memory:\/\/kyc\//);
    expect(kase.body.data.phone === null || /x/.test(kase.body.data.phone)).toBe(true);

    const noReason = await request(app)
      .post(`/api/v1/admin/kyc/${uid('ravi')}/decision`)
      .set(auth(tokens.admin))
      .send({ decision: 'reject' });
    expect(noReason.status).toBe(422);
    const rej = await request(app)
      .post(`/api/v1/admin/kyc/${uid('ravi')}/decision`)
      .set(auth(tokens.admin))
      .send({
        decision: 'reject',
        reasons: ['Face is not clearly visible'],
        note: 'Take it again without a cap.',
        failedSteps: ['selfie'],
      });
    expect(rej.status).toBe(200);
    expect(rej.body.data).toMatchObject({
      status: 'rejected',
      canSubmit: false,
      rejection: { reasons: ['Face is not clearly visible'] },
    });
    expect(rej.body.data.steps.selfie).toMatchObject({ state: 'failed', attemptsLeft: 3 });

    const me = await request(app).get('/api/v1/providers/me/kyc').set(auth(t));
    expect(me.body.data.missing).toEqual(['selfie']);
    const fixed = await request(app)
      .post('/api/v1/providers/kyc/selfie')
      .set(auth(t))
      .attach('photo', JPEG(), 'selfie.jpg');
    expect(fixed.body.data.canSubmit).toBe(true);
    expect((await request(app).post('/api/v1/providers/kyc/submit').set(auth(t)).send({})).body.data.status).toBe(
      'pending',
    );

    const appr = await request(app)
      .post(`/api/v1/admin/kyc/${uid('ravi')}/decision`)
      .set(auth(tokens.admin))
      .send({ decision: 'approve' });
    expect(appr.status).toBe(200);
    expect(appr.body.data).toMatchObject({ status: 'approved', level: 2, rejection: null });
    const again = await request(app)
      .post(`/api/v1/admin/kyc/${uid('ravi')}/decision`)
      .set(auth(tokens.admin))
      .send({ decision: 'approve' });
    expect(again.status).toBe(409);

    const profile = await request(app).get('/api/v1/providers/me').set(auth(t));
    expect(profile.body.data).toMatchObject({ canGoOnline: true, kyc: { status: 'approved' } });

    // A verified partner can still change the payout account.
    const change = await request(app)
      .post('/api/v1/providers/kyc/bank')
      .set(auth(t))
      .send({
        accountNumber: `55${crypto.randomInt(10000000, 99999999)}`,
        ifsc: 'HDFC0000001',
        holderName: `Ravi Kumar ${tag}`,
      });
    expect(change.status).toBe(200);
    expect(change.body.data.status).toBe('approved');

    const { data: events } = await db().from('kyc_events').select('kind').eq('partner_id', uid('ravi'));
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        'consent',
        'identity.digilocker',
        'selfie',
        'bank',
        'submit',
        'admin.view',
        'admin.decision',
        'bank.changed',
      ]),
    );
  });

  it('another account with the same Aadhaar is refused', async () => {
    // The fake provider derives identity from the name, so the same name = the same Aadhaar.
    const t = await partner('ravi2', `Ravi Kumar ${tag}`);
    const dl = await consentAndDigilocker(t);
    const res = await dl.complete();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DUPLICATE_IDENTITY');
    expect(res.body.data.kyc.steps.identity.state).toBe('failed');
  });

  it('DigiLocker: pending until allowed, and a denial ends the request', async () => {
    const t = await partner('meena', `Meena Iyer ${tag}`);
    await request(app).post('/api/v1/providers/kyc/consent').set(auth(t)).send({ version: 'partner-kyc-v1' });
    const s = await request(app).post('/api/v1/providers/kyc/digilocker/start').set(auth(t)).send({});
    const ref = s.body.data.verificationId;
    const pending = await request(app)
      .post('/api/v1/providers/kyc/digilocker/complete')
      .set(auth(t))
      .send({ verificationId: ref });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('DIGILOCKER_PENDING');
    // Someone else cannot complete my request.
    const other = await request(app)
      .post('/api/v1/providers/kyc/digilocker/complete')
      .set(auth(tokens.ravi2))
      .send({ verificationId: ref });
    expect(other.status).toBe(404);
    await request(app).post('/api/v1/providers/kyc/fake-digilocker').type('form').send({ ref, allow: '0' });
    const denied = await request(app)
      .post('/api/v1/providers/kyc/digilocker/complete')
      .set(auth(t))
      .send({ verificationId: ref });
    expect(denied.status).toBe(422);
    expect(denied.body.code).toBe('DIGILOCKER_DENIED');

    const back = await request(app).get(`/api/v1/providers/kyc/digilocker/return?ref=${ref}`);
    expect(back.status).toBe(200);
    expect(back.text).toContain(`serwish://kyc/digilocker?ref=${ref}`);
    const junk = await request(app).get('/api/v1/providers/kyc/digilocker/return?ref=<script>');
    expect(junk.text).not.toContain('<script>');
  });

  it('manual ID path goes to review, and uploads are checked', async () => {
    const t = tokens.meena;
    const noBack = await request(app)
      .post('/api/v1/providers/kyc/identity')
      .set(auth(t))
      .field('docType', 'driving_licence')
      .attach('front', JPEG(), 'front.jpg');
    expect(noBack.status).toBe(422);
    const notImage = await request(app)
      .post('/api/v1/providers/kyc/identity')
      .set(auth(t))
      .field('docType', 'pan')
      .attach('front', Buffer.from('MZ fake executable padding....'), 'front.jpg');
    expect(notImage.status).toBe(422);
    expect(notImage.body.errors[0].field).toBe('files.front');
    const json = await request(app).post('/api/v1/providers/kyc/identity').set(auth(t)).send({ docType: 'pan' });
    expect(json.status).toBe(415);

    const ok = await request(app)
      .post('/api/v1/providers/kyc/identity')
      .set(auth(t))
      .field('docType', 'driving_licence')
      .attach('front', JPEG(), 'front.jpg')
      .attach('back', JPEG(), 'back.jpg');
    expect(ok.status).toBe(200);
    expect(ok.body.data.steps.identity).toMatchObject({
      state: 'review',
      source: 'manual',
      docType: 'driving_licence',
      aadhaarLast4: null,
    });
    const stored = [...storage.objects.keys()].filter((k) => k.startsWith(`${uid('meena')}/id-driving_licence`));
    expect(stored).toHaveLength(2);

    // Selfie against a manual ID still needs a person.
    const s = await request(app).post('/api/v1/providers/kyc/selfie').set(auth(t)).attach('photo', JPEG(), 'me.jpg');
    expect(s.body.data.steps.selfie.state).toBe('review');
    // Bank name that differs from the typed name goes to review with a flag.
    const b = await request(app)
      .post('/api/v1/providers/kyc/bank')
      .set(auth(t))
      .send({
        accountNumber: `999${crypto.randomInt(1000000, 9999999)}`,
        ifsc: 'ICIC0000001',
        holderName: `Meena Iyer ${tag}`,
      });
    expect(b.status).toBe(200);
    expect(b.body.data.steps.bank.state).toBe('review');
    const cert = await request(app)
      .post('/api/v1/providers/kyc/certificate')
      .set(auth(t))
      .attach('file', Buffer.from('%PDF-1.4 certificate content here'), 'cert.pdf');
    expect(cert.body.data.steps.certificate.state).toBe('review');
    expect((await request(app).post('/api/v1/providers/kyc/submit').set(auth(t)).send({})).body.data.status).toBe(
      'pending',
    );

    const kase = await request(app)
      .get(`/api/v1/admin/kyc/${uid('meena')}`)
      .set(auth(tokens.admin));
    expect(kase.body.data.flags).toEqual(expect.arrayContaining(['manual_id', 'bank_name_mismatch']));
    expect(kase.body.data.documents.idBack).toBeTruthy();
  });

  it('access rules: customers and non-admins are kept out', async () => {
    const cust = fake.issue(uid('cust'), { name: 'Plain Customer' });
    await request(app).post('/api/v1/auth/session').set(auth(cust)).send({});
    expect((await request(app).get('/api/v1/providers/me/kyc').set(auth(cust))).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/providers/kyc/consent').set(auth(cust)).send({ version: 'partner-kyc-v1' }))
        .status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/admin/kyc/queue').set(auth(tokens.ravi))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/kyc/queue')).status).toBe(401);
    expect((await request(app).post('/api/v1/providers/kyc').set(auth(tokens.ravi)).send({})).status).toBe(410);
  });
});

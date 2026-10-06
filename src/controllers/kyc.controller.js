/**
 * Partner verification (KYC): consent, DigiLocker, another ID, selfie, bank
 * account, skill certificate, submit. Every endpoint answers with the full
 * verification state (utils/kycDto.js) so the app simply renders it.
 *
 * Privacy: full Aadhaar numbers, XML and account numbers never reach the
 * database or logs; only the last 4 digits, verified fields and salted hashes.
 */
import crypto from 'node:crypto';
import * as kyc from '../repos/kyc.repo.js';
import * as providers from '../repos/providers.repo.js';
import { invalidateActor } from '../middleware/auth.js';
import { kycProvider } from '../services/kyc/providers/index.js';
import { fakeDecide } from '../services/kyc/providers/fake.js';
import { kycStorage } from '../services/kyc/storage.js';
import { kycHash } from '../services/kyc/hash.js';
import { displayName, nameScore } from '../services/kyc/names.js';
import { KYC_CONSENT_VERSION, MAX_SELFIE_ATTEMPTS, certRequiredFor, toKyc } from '../utils/kycDto.js';
import { AppError, conflict, notFound, unavailable } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const MAX_DIGILOCKER_PER_DAY = 8;
const MAX_BANK_ATTEMPTS = 10;

/* ---------- helpers ---------- */

const load = async (partnerId) => {
  const profile = await providers.getOwnProfile(partnerId);
  if (!profile) throw notFound('Partner profile');
  return { profile, row: await kyc.getKyc(partnerId) };
};

const slugsOf = (profile) => (profile.categories ?? []).map((c) => c.category?.slug).filter(Boolean);

const dto = (profile, row) =>
  toKyc(profile, row, {
    digilockerAvailable: kycProvider().digilockerAvailable,
    certRequired: certRequiredFor(slugsOf(profile)),
  });

/** Reload and answer with the current state. */
const respond = async (res, partnerId, message = 'OK') => {
  const { profile, row } = await load(partnerId);
  return ok(res, dto(profile, row), { message });
};

/** A step failed: 422 with the current state so the app can show which step and why. */
const stepFailed = async (partnerId, code, message) => {
  const { profile, row } = await load(partnerId);
  return new AppError(422, code, message, { kyc: dto(profile, row) });
};

/** Steps can change before submitting, or after a rejection. allowApproved: bank changes later on. */
const assertEditable = (profile, { allowApproved = false } = {}) => {
  if (profile.kyc_status === 'pending')
    throw conflict('Your verification is in review. You can make changes if our team asks for them.', 'KYC_IN_REVIEW');
  if (profile.kyc_status === 'approved' && !allowApproved) throw conflict('You are already verified.', 'KYC_APPROVED');
};

const assertConsent = (row) => {
  if (!row?.consent_at || row.consent_version !== KYC_CONSENT_VERSION) {
    throw conflict('Please agree to the verification terms first.', 'CONSENT_REQUIRED');
  }
};

const save = async (partnerId, patch) => {
  const row = await kyc.saveKyc(partnerId, patch);
  await kyc.markInProgress(partnerId);
  invalidateActor(partnerId);
  return row;
};

const storePhoto = async (partnerId, kind, file) => {
  const path = `${partnerId}/${kind}-${crypto.randomUUID()}.${file.ext}`;
  await kycStorage().put(path, file.buffer, file.type);
  return path;
};

/** Best effort: old photos are replaced, never kept around. */
const dropPhotos = (paths) =>
  kycStorage()
    .remove(paths.filter(Boolean))
    .catch(() => undefined);

const ageOn = (isoDob, now = new Date()) => {
  const d = new Date(`${isoDob}T00:00:00Z`);
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
};

/** Origin for links the provider sends the partner back to. */
const publicBase = (req) => env.PUBLIC_API_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;

const event = (partnerId, kind, result, detail = {}) =>
  kyc
    .addEvent(partnerId, { kind, result, detail })
    .catch((err) => logger.warn('KYC event not saved', { kind, error: err?.message }));

/* ---------- endpoints ---------- */

/** GET /providers/me/kyc */
export const getKyc = async (req, res) => respond(res, req.actor.id);

/** POST /providers/kyc/consent { version } */
export const consent = async (req, res) => {
  const me = req.actor.id;
  const { profile } = await load(me);
  assertEditable(profile);
  if (req.body.version !== KYC_CONSENT_VERSION) {
    throw conflict('The verification terms were updated. Please read them again.', 'CONSENT_OUTDATED');
  }
  await save(me, {
    consent_version: KYC_CONSENT_VERSION,
    consent_at: new Date().toISOString(),
    consent_ip: req.ip ?? null,
  });
  await event(me, 'consent', 'ok', { version: KYC_CONSENT_VERSION });
  return respond(res, me, 'Consent saved');
};

/** POST /providers/kyc/digilocker/start -> { verificationId, consentUrl, expiresAt } */
export const startDigilocker = async (req, res) => {
  const me = req.actor.id;
  const p = kycProvider();
  if (!p.digilockerAvailable)
    throw new AppError(
      503,
      'DIGILOCKER_UNAVAILABLE',
      'DigiLocker is not available right now. Please upload another ID.',
    );
  const { profile, row } = await load(me);
  assertEditable(profile);
  assertConsent(row);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  if ((await kyc.countSessionsSince(me, since)) >= MAX_DIGILOCKER_PER_DAY) {
    throw new AppError(
      429,
      'TOO_MANY_ATTEMPTS',
      'Too many DigiLocker attempts today. Try again tomorrow or upload another ID.',
    );
  }
  const ref = `swdl_${crypto.randomBytes(12).toString('hex')}`;
  const base = publicBase(req);
  const started = await p.startDigilocker({
    ref,
    baseUrl: base,
    redirectUrl: `${base}/api/v1/providers/kyc/digilocker/return?ref=${ref}`,
    name: profile.user?.name,
  });
  await kyc.createSession({
    partner_id: me,
    provider: p.name,
    provider_ref: ref,
    expires_at: started.expiresAt.toISOString(),
  });
  await event(me, 'digilocker.start', 'pending');
  return ok(res, { verificationId: ref, consentUrl: started.consentUrl, expiresAt: started.expiresAt.toISOString() });
};

/** POST /providers/kyc/digilocker/complete { verificationId } */
export const completeDigilocker = async (req, res) => {
  const me = req.actor.id;
  const p = kycProvider();
  const session = await kyc.getSession(me, req.body.verificationId);
  if (!session) throw notFound('DigiLocker request');
  if (session.status === 'completed') return respond(res, me, 'Already verified');
  const { profile } = await load(me);
  assertEditable(profile);

  if (['denied', 'expired', 'failed'].includes(session.status)) {
    throw new AppError(
      422,
      `DIGILOCKER_${session.status.toUpperCase()}`,
      'This DigiLocker request has ended. Please start again.',
    );
  }
  const status = await p.digilockerStatus(session.provider_ref);
  if (status === 'pending') {
    if (new Date(session.expires_at) < new Date()) {
      await kyc.updateSession(session.id, { status: 'expired' });
      throw new AppError(422, 'DIGILOCKER_EXPIRED', 'The DigiLocker link expired. Please start again.');
    }
    throw conflict('Waiting for you to allow access on DigiLocker.', 'DIGILOCKER_PENDING');
  }
  if (status === 'denied' || status === 'expired' || status === 'failed') {
    await kyc.updateSession(session.id, { status, completed_at: new Date().toISOString() });
    await event(me, 'digilocker.complete', 'failed', { status });
    const msg =
      status === 'denied'
        ? 'You did not allow access on DigiLocker. Start again or upload another ID.'
        : 'The DigiLocker request expired. Please start again.';
    throw new AppError(422, status === 'denied' ? 'DIGILOCKER_DENIED' : 'DIGILOCKER_EXPIRED', msg);
  }

  const a = await p.fetchAadhaar(session.provider_ref);
  if (!a?.name || !a.last4) {
    await kyc.updateSession(session.id, { status: 'failed', completed_at: new Date().toISOString() });
    throw unavailable('DigiLocker did not return your Aadhaar. Please try again or upload another ID.');
  }

  const old = await kyc.getKyc(me);
  const flags = new Set(
    (old?.flags ?? []).filter((f) => !['duplicate_identity', 'id_name_mismatch', 'underage'].includes(f)),
  );
  const patch = {
    id_source: 'digilocker',
    id_doc_type: 'aadhaar',
    id_name: displayName(a.name),
    id_dob: a.dob,
    id_gender: a.gender,
    id_city: a.city?.slice(0, 80) ?? null,
    id_state_name: a.state?.slice(0, 80) ?? null,
    id_pincode: a.pincode,
    id_aadhaar_last4: a.last4,
    id_front_path: null,
    id_back_path: null,
    id_reason: null,
  };

  // The full number never leaves DigiLocker; name + date of birth + last 4 identify a person well enough.
  const hash = a.dob ? kycHash('aadhaar', a.name, a.dob, a.last4) : null;
  const owner = hash ? await kyc.idHashOwner(hash, me) : null;
  if (a.dob && ageOn(a.dob) < 18) {
    Object.assign(patch, { id_state: 'failed', id_reason: 'Partners must be 18 or older.', id_hash: null });
    flags.add('underage');
  } else if (owner) {
    Object.assign(patch, {
      id_state: 'failed',
      id_reason: 'This Aadhaar is already linked to another SerWish account. Contact support.',
      id_hash: null,
    });
    flags.add('duplicate_identity');
  } else {
    Object.assign(patch, { id_state: 'done', id_hash: hash, id_verified_at: new Date().toISOString() });
    if (nameScore(a.name, profile.user?.name) < 60) flags.add('id_name_mismatch');
  }

  if (a.photo && patch.id_state === 'done') {
    patch.id_photo_path = await storePhoto(me, 'id-photo', { buffer: a.photo, type: 'image/jpeg', ext: 'jpg' });
  }
  await dropPhotos([old?.id_photo_path, old?.id_front_path, old?.id_back_path]);
  await save(me, { ...patch, flags: [...flags] });
  await kyc.updateSession(session.id, { status: 'completed', completed_at: new Date().toISOString() });
  await event(me, 'identity.digilocker', patch.id_state === 'done' ? 'ok' : 'failed', { flags: [...flags] });

  if (patch.id_state === 'failed')
    throw await stepFailed(me, flags.has('underage') ? 'UNDERAGE' : 'DUPLICATE_IDENTITY', patch.id_reason);
  return respond(res, me, 'Identity verified with DigiLocker');
};

const NEEDS_BACK = { pan: false, driving_licence: true, voter_id: true, passport: true };

/** POST /providers/kyc/identity (multipart: docType, front, back?) - another government ID, checked by the team. */
export const uploadIdentity = async (req, res) => {
  const me = req.actor.id;
  const { profile, row } = await load(me);
  assertEditable(profile);
  assertConsent(row);
  const { docType } = req.body;
  if (NEEDS_BACK[docType] && !req.uploads.back) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid', [
      { field: 'files.back', message: 'Add a photo of the back side' },
    ]);
  }
  const front = await storePhoto(me, `id-${docType}-front`, req.uploads.front);
  const back = req.uploads.back ? await storePhoto(me, `id-${docType}-back`, req.uploads.back) : null;
  await dropPhotos([row?.id_photo_path, row?.id_front_path, row?.id_back_path]);
  const flags = (row?.flags ?? []).filter((f) => !['duplicate_identity', 'id_name_mismatch', 'underage'].includes(f));
  await save(me, {
    id_state: 'review',
    id_source: 'manual',
    id_doc_type: docType,
    id_name: null,
    id_dob: null,
    id_gender: null,
    id_aadhaar_last4: null,
    id_hash: null,
    id_photo_path: null,
    id_front_path: front,
    id_back_path: back,
    id_reason: null,
    id_verified_at: null,
    flags: [...flags, 'manual_id'],
  });
  await event(me, 'identity.manual', 'review', { docType });
  return respond(res, me, 'ID received. Our team will check it.');
};

/** POST /providers/kyc/selfie (multipart: photo) - liveness + face match against the ID photo. */
export const uploadSelfie = async (req, res) => {
  const me = req.actor.id;
  const { profile, row } = await load(me);
  assertEditable(profile);
  assertConsent(row);
  if (!['done', 'review'].includes(row?.id_state))
    throw conflict('Verify your ID before the selfie.', 'IDENTITY_FIRST');
  if (row.selfie_state === 'review' && (row.selfie_attempts ?? 0) >= MAX_SELFIE_ATTEMPTS) {
    throw conflict('Our team is already checking your selfie.', 'SELFIE_IN_REVIEW');
  }

  const selfie = req.uploads.photo;
  const path = await storePhoto(me, 'selfie', selfie);
  await dropPhotos([row.selfie_path]);
  const attempts = (row.selfie_attempts ?? 0) + 1;

  // Reference photo: DigiLocker's Aadhaar photo, else the front of the uploaded ID.
  const refPath = row.id_photo_path ?? row.id_front_path;
  const refBuf = refPath ? await kycStorage().get(refPath) : null;
  const reference = refBuf ? { buffer: refBuf, type: 'image/jpeg' } : null;
  const result = await kycProvider().checkFace({
    ref: `swfc_${crypto.randomBytes(10).toString('hex')}`,
    selfie,
    reference,
  });

  const base = {
    selfie_path: path,
    selfie_attempts: attempts,
    selfie_score: result?.score ?? null,
    selfie_liveness: result?.liveness ?? null,
  };
  let state;
  let reason = null;
  if (!result) {
    state = 'review'; // no automatic check configured
  } else if (result.liveness === false) {
    state = 'failed';
    reason = result.livenessReason ?? 'Take the selfie live, not a photo of a photo.';
  } else if (result.match === false) {
    state = 'failed';
    reason =
      result.matchReason ?? 'Your face does not match the ID photo. Try again in good light, without a cap or glasses.';
  } else if (result.match === true) {
    state = row.id_source === 'manual' ? 'review' : 'done';
  } else {
    state = 'review'; // live, but nothing to compare with
  }

  // After the last try a person decides instead of blocking the partner.
  if (state === 'failed' && attempts >= MAX_SELFIE_ATTEMPTS) {
    await save(me, {
      ...base,
      selfie_state: 'review',
      selfie_reason: 'Our team will compare your selfie with your ID.',
    });
    await event(me, 'selfie', 'review', { attempts, score: result?.score ?? null, liveness: result?.liveness ?? null });
    return respond(res, me, 'Selfie sent to our team for a manual check');
  }
  await save(me, {
    ...base,
    selfie_state: state,
    selfie_reason: reason,
    selfie_verified_at: state === 'done' ? new Date().toISOString() : null,
  });
  await event(me, 'selfie', state === 'done' ? 'ok' : state, {
    attempts,
    score: result?.score ?? null,
    liveness: result?.liveness ?? null,
  });
  if (state === 'failed')
    throw await stepFailed(me, result.liveness === false ? 'LIVENESS_FAILED' : 'FACE_MISMATCH', reason);
  return respond(res, me, state === 'done' ? 'Face verified' : 'Selfie received. Our team will check it.');
};

/** POST /providers/kyc/bank { accountNumber, ifsc, holderName } - penny drop with name match. */
export const verifyBank = async (req, res) => {
  const me = req.actor.id;
  const { profile, row } = await load(me);
  assertEditable(profile, { allowApproved: true });
  assertConsent(row);
  if ((row?.bank_attempts ?? 0) >= MAX_BANK_ATTEMPTS) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many bank account attempts. Contact support to continue.');
  }
  const { accountNumber, ifsc, holderName } = req.body;
  const accountHash = kycHash('bank', accountNumber, ifsc.slice(0, 4));
  const attempts = (row?.bank_attempts ?? 0) + 1;
  const flags = new Set((row?.flags ?? []).filter((f) => !['shared_bank_account', 'bank_name_mismatch'].includes(f)));

  const result = await kycProvider().verifyBank({ accountNumber, ifsc, name: holderName });
  const base = {
    bank_holder_name: displayName(holderName),
    bank_account_last4: accountNumber.slice(-4),
    bank_account_hash: accountHash,
    bank_ifsc: ifsc,
    bank_attempts: attempts,
    bank_name_at_bank: result?.nameAtBank ? displayName(result.nameAtBank).slice(0, 120) : null,
  };

  if (result && !result.valid) {
    await save(me, {
      ...base,
      bank_account_hash: null,
      bank_state: 'failed',
      bank_reason: 'This account could not be verified. Check the account number and IFSC.',
      bank_name_score: null,
      flags: [...flags],
    });
    await event(me, 'bank', 'failed', { attempts });
    throw await stepFailed(
      me,
      'BANK_INVALID',
      'This account could not be verified. Check the account number and IFSC.',
    );
  }

  let state = 'review';
  let reason = null;
  let score = null;
  if (result) {
    // Compare the bank's name with the verified ID name (or what the partner typed when the ID is manual).
    const idName = row?.id_name ?? holderName;
    score = result.nameAtBank ? nameScore(result.nameAtBank, idName) : (result.score ?? 0);
    if (score >= env.KYC_NAME_MATCH_MIN) {
      state = 'done';
    } else {
      flags.add('bank_name_mismatch');
      reason = `The bank shows "${base.bank_name_at_bank ?? 'a different name'}". Our team will check that this account is yours.`;
    }
  }
  if (await kyc.bankHashUsedElsewhere(accountHash, me)) {
    flags.add('shared_bank_account');
    if (state === 'done') state = 'review';
  }
  await save(me, {
    ...base,
    bank_state: state,
    bank_reason: reason,
    bank_name_score: score,
    bank_verified_at: state === 'done' ? new Date().toISOString() : null,
    flags: [...flags],
  });
  await event(me, profile.kyc_status === 'approved' ? 'bank.changed' : 'bank', state === 'done' ? 'ok' : 'review', {
    attempts,
    score,
    flags: [...flags],
  });
  return respond(res, me, state === 'done' ? 'Bank account verified' : 'Bank account saved. Our team will confirm it.');
};

/** POST /providers/kyc/certificate (multipart: file) */
export const uploadCertificate = async (req, res) => {
  const me = req.actor.id;
  const { profile, row } = await load(me);
  assertEditable(profile);
  assertConsent(row);
  const path = await storePhoto(me, 'certificate', req.uploads.file);
  await dropPhotos([row?.cert_path]);
  await save(me, { cert_state: 'review', cert_path: path, cert_reason: null });
  await event(me, 'certificate', 'review');
  return respond(res, me, 'Certificate uploaded');
};

/** POST /providers/kyc/submit */
export const submit = async (req, res) => {
  const me = req.actor.id;
  const { profile, row } = await load(me);
  assertEditable(profile);
  const state = dto(profile, row);
  if (!state.canSubmit) {
    throw new AppError(409, 'KYC_INCOMPLETE', 'Finish every step before submitting.', {
      kyc: state,
      missing: state.missing,
    });
  }
  const moved = await kyc.submit(me);
  if (!moved) throw conflict('Your verification changed meanwhile. Please refresh.', 'KYC_STATE_CHANGED');
  await kyc.saveKyc(me, { rejection_reasons: [], rejection_note: null });
  invalidateActor(me);
  await event(me, 'submit', 'pending', { flags: row?.flags ?? [] });
  return respond(res, me, 'Submitted for review');
};

/* ---------- public pages (no sign-in) ---------- */

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:32px 20px;color:#111318;text-align:center}
h1{font-size:22px}p{color:#4B4F58;line-height:1.5}.btn{display:block;margin:16px auto 0;max-width:320px;padding:14px;border-radius:12px;border:0;font-size:16px;font-weight:600;text-decoration:none;cursor:pointer}
.primary{background:#FF6B00;color:#fff}.ghost{background:#F3F4F5;color:#111318}form{margin:0}</style></head><body>${body}</body></html>`;

const REF_RE = /^swdl_[a-f0-9]{24}$/;

/** GET /providers/kyc/digilocker/return?ref= - DigiLocker sends the partner here; we send them back to the app. */
export const digilockerReturn = (req, res) => {
  const ref = REF_RE.test(String(req.query.ref ?? '')) ? req.query.ref : '';
  const deepLink = `serwish://kyc/digilocker${ref ? `?ref=${ref}` : ''}`;
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  return res
    .status(200)
    .type('html')
    .send(
      page(
        'Back to SerWish',
        `<meta http-equiv="refresh" content="0;url=${deepLink}"><h1>All done on DigiLocker</h1>
<p>Return to the SerWish app to finish your verification.</p><a class="btn primary" href="${deepLink}">Open SerWish</a>`,
      ),
    );
};

/** GET /providers/kyc/fake-digilocker?ref= - simulated consent page (KYC_PROVIDER=fake only). */
export const fakeDigilockerPage = (req, res) => {
  if (kycProvider().name !== 'fake') throw notFound();
  const ref = REF_RE.test(String(req.query.ref ?? '')) ? req.query.ref : null;
  if (!ref) throw notFound('DigiLocker request');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  return res.type('html').send(
    page(
      'DigiLocker (test)',
      `<h1>DigiLocker test page</h1><p>This server simulates DigiLocker. Nothing real is shared.</p>
<form method="post"><input type="hidden" name="ref" value="${ref}"><input type="hidden" name="allow" value="1"><button class="btn primary">Allow SerWish</button></form>
<form method="post"><input type="hidden" name="ref" value="${ref}"><input type="hidden" name="allow" value="0"><button class="btn ghost">Deny</button></form>`,
    ),
  );
};

/** POST /providers/kyc/fake-digilocker (form) */
export const fakeDigilockerDecide = (req, res) => {
  if (kycProvider().name !== 'fake') throw notFound();
  const ref = REF_RE.test(String(req.body?.ref ?? '')) ? req.body.ref : null;
  if (!ref || !fakeDecide(ref, req.body.allow === '1')) throw notFound('DigiLocker request');
  return res.redirect(303, `/api/v1/providers/kyc/digilocker/return?ref=${ref}`);
};

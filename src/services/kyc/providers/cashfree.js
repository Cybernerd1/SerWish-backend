/**
 * Cashfree Secure ID (Verification API).
 *   DigiLocker  POST /digilocker, GET /digilocker?verification_id=, GET /digilocker/document/AADHAAR?verification_id=
 *   Face        POST /face-liveness, POST /face-match (multipart)
 *   Bank        POST /bank-account/sync
 * Docs: https://www.cashfree.com/docs/api-reference/vrs/v2/digilocker/create-digilocker-url
 * Only masked / derived values leave this file: the Aadhaar XML link is ignored.
 */
import { env } from '../../../config/env.js';
import { unavailable } from '../../../utils/errors.js';
import { logger } from '../../../utils/logger.js';

const BASE =
  env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/verification'
    : 'https://sandbox.cashfree.com/verification';
const TIMEOUT_MS = 20000;

const headers = () => ({
  'x-client-id': env.CASHFREE_CLIENT_ID,
  'x-client-secret': env.CASHFREE_CLIENT_SECRET,
  'x-api-version': env.CASHFREE_API_VERSION,
});

const call = async (method, path, { json, form } = {}) => {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: json ? { ...headers(), 'content-type': 'application/json' } : headers(),
      body: json ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error('Cashfree request failed', { path: path.split('?')[0], error: err?.message });
    throw unavailable('Verification service is not reachable. Please try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.warn('Cashfree error', { path: path.split('?')[0], status: res.status, code: body?.code, type: body?.type });
    const e = new Error(body?.message || `Cashfree ${res.status}`);
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body;
};

/** "02-02-1995" -> "1995-02-02" */
const isoDob = (d) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const STATUS = { PENDING: 'pending', AUTHENTICATED: 'authenticated', EXPIRED: 'expired', CONSENT_DENIED: 'denied' };

const blob = (file) => new Blob([file.buffer], { type: file.type });

export const cashfreeProvider = {
  name: 'cashfree',
  digilockerAvailable: true,

  startDigilocker: async ({ ref, redirectUrl }) => {
    try {
      const r = await call('POST', '/digilocker', {
        json: { verification_id: ref, document_requested: ['AADHAAR'], redirect_url: redirectUrl, user_flow: 'signin' },
      });
      if (!r.url) throw new Error('No DigiLocker URL returned');
      // The provider's link is valid for 10 minutes.
      return { consentUrl: r.url, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
    } catch (err) {
      if (err.status) throw unavailable('DigiLocker could not be started. Please try again or use another ID.');
      throw err;
    }
  },

  digilockerStatus: async (ref) => {
    try {
      const r = await call('GET', `/digilocker?verification_id=${encodeURIComponent(ref)}`);
      return STATUS[r.status] ?? 'pending';
    } catch (err) {
      if (err.status === 404) return 'expired';
      if (err.status) throw unavailable('Could not check DigiLocker. Please try again.');
      throw err;
    }
  },

  fetchAadhaar: async (ref) => {
    try {
      const r = await call('GET', `/digilocker/document/AADHAAR?verification_id=${encodeURIComponent(ref)}`);
      if (r.status && r.status !== 'SUCCESS') return null;
      const last4 = /([0-9]{4})$/.exec(r.uid ?? '')?.[1] ?? null;
      const addr = r.split_address ?? {};
      return {
        name: r.name ?? null,
        dob: isoDob(r.dob),
        gender: ['M', 'F', 'T'].includes(r.gender) ? r.gender : null,
        city: addr.dist || addr.vtc || null,
        state: addr.state || null,
        pincode: /^[0-9]{6}$/.test(addr.pincode ?? '') ? addr.pincode : null,
        last4,
        photo: r.photo_link ? Buffer.from(r.photo_link, 'base64') : null,
      };
    } catch (err) {
      if (err.status) throw unavailable('Could not read your Aadhaar from DigiLocker. Please try again.');
      throw err;
    }
  },

  checkFace: async ({ ref, selfie, reference }) => {
    try {
      const lf = new FormData();
      lf.append('verification_id', `${ref}-l`);
      lf.append('image', blob(selfie), 'selfie.jpg');
      const live = await call('POST', '/face-liveness', { form: lf });
      if (live.status && live.status !== 'SUCCESS') {
        const reasons = {
          FACE_NOT_DETECTED: 'No face found. Hold the phone at eye level in good light.',
          MULTIPLE_FACES_DETECTED: 'Only your face should be in the photo.',
          REAL_FACE_NOT_DETECTED: 'Take the selfie live, not a photo of a photo.',
        };
        return {
          liveness: false,
          livenessReason: reasons[live.status] ?? 'Try again in good light.',
          match: null,
          score: null,
        };
      }
      if (live.liveness === false)
        return {
          liveness: false,
          livenessReason: 'Take the selfie live, not a photo of a photo.',
          match: null,
          score: null,
        };
      if (!reference) return { liveness: true, match: null, score: null };

      const mf = new FormData();
      mf.append('verification_id', `${ref}-m`);
      mf.append('first_image', blob(selfie), 'selfie.jpg');
      mf.append('second_image', blob(reference), 'id.jpg');
      mf.append('threshold', String(env.KYC_FACE_MATCH_THRESHOLD));
      const m = await call('POST', '/face-match', { form: mf });
      if (m.status === 'MULTIPLE_FACE_DETECTED')
        return { liveness: true, match: false, score: null, matchReason: 'Only your face should be in the photo.' };
      return {
        liveness: true,
        match: m.face_match_result === 'YES',
        score: typeof m.face_match_score === 'number' ? m.face_match_score : null,
      };
    } catch (err) {
      if (err.status) throw unavailable('Face check is not available right now. Please try again.');
      throw err;
    }
  },

  verifyBank: async ({ accountNumber, ifsc, name }) => {
    try {
      const r = await call('POST', '/bank-account/sync', { json: { bank_account: accountNumber, ifsc, name } });
      const score = Number.parseFloat(r.name_match_score);
      return {
        valid: r.account_status === 'VALID',
        nameAtBank: r.name_at_bank ?? null,
        score: Number.isFinite(score) ? score : null,
      };
    } catch (err) {
      // 4xx on bad input means the account cannot be verified; anything else is an outage.
      if (err.status === 400 || err.status === 422) return { valid: false, nameAtBank: null, score: null };
      if (err.status) throw unavailable('Bank check is not available right now. Please try again.');
      throw err;
    }
  },
};

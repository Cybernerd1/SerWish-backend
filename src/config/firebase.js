/**
 * Firebase Admin (audit BE-LOG, BE-R10).
 * - Credentials come from a service-account JSON (raw or base64), a file path,
 *   or the three FIREBASE_* variables. The private key is validated at boot so
 *   a mangled key fails fast with a clear message instead of on the first login.
 * - Token verification checks revocation; positive results are cached briefly
 *   so the check does not cost a network round trip on every request.
 * - No getUser() calls: the decoded token already has everything we need.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import admin from 'firebase-admin';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const normaliseKey = (key) => {
  let k = String(key).trim();
  // Copied out of the service-account JSON along with its closing quote and the
  // trailing comma, so the quotes can be unbalanced. A PEM contains neither
  // character, which makes stripping them unconditionally safe.
  k = k.replace(/[,;]+$/, '').trim();
  k = k.replace(/^["']+/, '').replace(/["']+$/, '').trim();
  // Literal "\n"/"\r\n" escapes (single-line env fields) and CRLF from dashboard editors.
  return k.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
};

const canParse = (pem) => {
  try {
    crypto.createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
};

/**
 * Rebuild a PEM whose line breaks were lost on the way into the environment:
 * newlines turned into spaces, or stripped altogether. The base64 body is
 * intact in both cases, so re-wrapping it at 64 columns restores a valid key.
 */
const repairPem = (k) => {
  const flat = k.replace(/\s+/g, '');
  const m = /^-+BEGIN([A-Z]*PRIVATEKEY)-+([A-Za-z0-9+/=]+)-+END\1-+$/.exec(flat);
  if (!m) return null;
  const label = m[1] === 'PRIVATEKEY' ? 'PRIVATE KEY' : m[1].replace('PRIVATEKEY', ' PRIVATE KEY');
  return `-----BEGIN ${label}-----\n${m[2].match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
};

/** Shape of the key we were handed, for the error message. Never logs the key itself. */
const describeKey = (k) =>
  `length=${k.length}, lines=${k.split('\n').length}, ` +
  `beginMarker=${/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(k)}, ` +
  `endMarker=${/-----END [A-Z ]*PRIVATE KEY-----/.test(k)}`;

/** Resolve service-account credentials from env. Exported for tests. */
export const resolveServiceAccount = (e = env) => {
  let account;
  let source;
  if (e.FIREBASE_SERVICE_ACCOUNT_JSON) {
    source = 'FIREBASE_SERVICE_ACCOUNT_JSON';
    const raw = e.FIREBASE_SERVICE_ACCOUNT_JSON.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, '');
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    try {
      account = JSON.parse(text);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON).');
    }
  } else if (e.GOOGLE_APPLICATION_CREDENTIALS) {
    source = 'GOOGLE_APPLICATION_CREDENTIALS';
    try {
      account = JSON.parse(fs.readFileSync(e.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    } catch (err) {
      throw new Error(`Could not read GOOGLE_APPLICATION_CREDENTIALS: ${err.message}`);
    }
  } else if (e.FIREBASE_PROJECT_ID && e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY) {
    source = 'FIREBASE_PRIVATE_KEY';
    account = {
      project_id: e.FIREBASE_PROJECT_ID,
      client_email: e.FIREBASE_CLIENT_EMAIL,
      private_key: e.FIREBASE_PRIVATE_KEY,
    };
  } else {
    return null;
  }

  const projectId = account.project_id ?? account.projectId;
  const clientEmail = account.client_email ?? account.clientEmail;
  let privateKey = normaliseKey(account.private_key ?? account.privateKey ?? '');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase service account must include project_id, client_email and private_key.');
  }
  if (!canParse(privateKey)) {
    const repaired = repairPem(privateKey);
    if (!repaired || !canParse(repaired)) {
      throw new Error(
        `Firebase private key from ${source} could not be parsed (${describeKey(privateKey)}). ` +
          'Paste the whole service-account JSON into FIREBASE_SERVICE_ACCOUNT_JSON (base64 is fine) instead of the key alone.',
      );
    }
    privateKey = repaired;
    logger.warn(`Firebase private key from ${source} had no line breaks; rebuilt the PEM.`);
  }
  return { projectId, clientEmail, privateKey };
};

let auth = null;
let messaging = null;

/** Initialise once at boot. Throws on bad credentials (fail fast). */
export const initFirebase = () => {
  if (auth) return auth;
  const account = resolveServiceAccount();
  if (!account) {
    logger.warn('Firebase Admin is not configured; authenticated routes will return 503.');
    return null;
  }
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(account) });
  auth = admin.auth(app);
  messaging = admin.messaging(app);
  logger.info(`Firebase Admin ready for project ${account.projectId}`);
  return auth;
};

/** Test hook: inject a fake auth implementation. */
export const __setFirebaseAuthForTests = (fake) => {
  auth = fake;
};

export const getMessaging = () => messaging;

const REVOCATION_CACHE_MS = 5 * 60 * 1000;
const verifiedCache = new Map(); // token -> { decoded, until }

const pruneCache = () => {
  if (verifiedCache.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of verifiedCache) if (v.until < now) verifiedCache.delete(k);
};

export class AuthUnavailableError extends Error {}

/**
 * Verify a Firebase ID token, including revocation. Returns the decoded token.
 * @param {string} idToken
 * @param {{ fresh?: boolean }} [opts] fresh=true skips the cache (sign-in, logout)
 */
export const verifyIdToken = async (idToken, opts = {}) => {
  if (!auth) throw new AuthUnavailableError('Firebase Admin is not configured');
  const now = Date.now();
  const hit = !opts.fresh && verifiedCache.get(idToken);
  if (hit && hit.until > now && hit.decoded.exp * 1000 > now) return hit.decoded;
  const decoded = await auth.verifyIdToken(idToken, true);
  pruneCache();
  verifiedCache.set(idToken, { decoded, until: Math.min(now + REVOCATION_CACHE_MS, decoded.exp * 1000) });
  return decoded;
};

/** Sign the user out everywhere and drop cached verifications. */
export const revokeSessions = async (uid) => {
  if (!auth) throw new AuthUnavailableError('Firebase Admin is not configured');
  await auth.revokeRefreshTokens(uid);
  for (const [k, v] of verifiedCache) if (v.decoded.uid === uid) verifiedCache.delete(k);
};

export const clearTokenCache = () => verifiedCache.clear();

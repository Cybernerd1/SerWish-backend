/**
 * Authentication: verifies the Firebase ID token (signature, expiry, revocation)
 * and loads the account from our database. Role comes from the database, never
 * from the client or token claims.
 *
 *   req.auth  = decoded Firebase token
 *   req.actor = { id, isPartner, kycStatus, isAdmin }
 */
import { verifyIdToken, AuthUnavailableError } from '../config/firebase.js';
import * as users from '../repos/users.repo.js';
import { unauthorized, forbidden, unavailable } from '../utils/errors.js';

const ACTOR_TTL_MS = 30 * 1000;
const actorCache = new Map(); // uid -> { actor, until }

export const invalidateActor = (uid) => actorCache.delete(uid);

const toActor = (row) => ({
  id: row.id,
  isPartner: !!row.provider,
  kycStatus: row.provider?.kyc_status ?? null,
  isAdmin: !!row.is_admin,
});

/** Load (cached) actor for a uid; null if the account does not exist yet. */
export const loadActor = async (uid) => {
  const hit = actorCache.get(uid);
  if (hit && hit.until > Date.now()) return hit.actor;
  const row = await users.findById(uid);
  if (row && (!row.is_active || row.deleted_at))
    throw forbidden('This account has been deactivated', 'ACCOUNT_DISABLED');
  const actor = row ? toActor(row) : null;
  if (actorCache.size > 10000) actorCache.clear();
  actorCache.set(uid, { actor, until: Date.now() + ACTOR_TTL_MS });
  return actor;
};

export const bearer = (header) => {
  if (typeof header !== 'string') return null;
  const m = header.match(/^Bearer\s+([A-Za-z0-9._-]{20,4096})$/);
  return m ? m[1] : null;
};

/** Map Firebase Admin errors to API errors. */
export const tokenError = (err) => {
  if (err instanceof AuthUnavailableError) return unavailable('Sign-in is temporarily unavailable');
  switch (err?.code) {
    case 'auth/id-token-expired':
      return unauthorized('Your session expired. Please sign in again.', 'TOKEN_EXPIRED');
    case 'auth/id-token-revoked':
    case 'auth/user-disabled':
      return unauthorized('Your session was signed out. Please sign in again.', 'TOKEN_REVOKED');
    default:
      return unauthorized('Invalid sign-in token', 'TOKEN_INVALID');
  }
};

const verifyHeader = async (req, { fresh = false, allowBody = false } = {}) => {
  // v1 app versions send the token in the body of /auth/verify-*; v2 uses the header.
  const fromBody = allowBody && typeof req.body?.idToken === 'string' ? bearer(`Bearer ${req.body.idToken}`) : null;
  const token = bearer(req.headers.authorization) ?? fromBody;
  if (!token) throw unauthorized('Missing or malformed Authorization header', 'TOKEN_MISSING');
  try {
    return await verifyIdToken(token, { fresh });
  } catch (err) {
    throw tokenError(err);
  }
};

/** Token only (used by /auth/session, before the account exists). */
export const verifyToken = async (req, _res, next) => {
  try {
    req.auth = await verifyHeader(req, { fresh: true, allowBody: true });
    next();
  } catch (err) {
    next(err);
  }
};

/** Token + existing account. */
export const authenticate = async (req, _res, next) => {
  try {
    req.auth = await verifyHeader(req);
    let actor;
    try {
      actor = await loadActor(req.auth.uid);
    } catch (err) {
      // Audit BE-X11: a database hiccup is "try again", never "you are someone else".
      if (err?.status) throw err;
      throw unavailable('We could not load your account. Please try again.');
    }
    if (!actor) throw unauthorized('Finish signing in first', 'ACCOUNT_NOT_FOUND');
    req.actor = actor;
    next();
  } catch (err) {
    next(err);
  }
};

export const requirePartner = (req, _res, next) =>
  next(req.actor?.isPartner ? undefined : forbidden('Only SerWish partners can do this', 'PARTNER_ONLY'));

export const requireApprovedPartner = (req, _res, next) =>
  next(
    req.actor?.isPartner && req.actor.kycStatus === 'approved'
      ? undefined
      : forbidden('Your KYC must be approved first', 'KYC_NOT_APPROVED'),
  );

export const requireAdmin = (req, _res, next) => next(req.actor?.isAdmin ? undefined : forbidden());

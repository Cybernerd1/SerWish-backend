import * as users from '../repos/users.repo.js';
import { revokeSessions } from '../config/firebase.js';
import { invalidateActor } from '../middleware/auth.js';
import { toUser } from '../utils/dto.js';
import { ok } from '../utils/response.js';
import { forbidden } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const PARTNER_ROLES = new Set(['partner', 'provider']);

/**
 * POST /auth/session  (aliases: /auth/verify-phone, /auth/verify-email, /auth/google)
 * The app signs in with Firebase (Google, phone OTP, or email for testers) and
 * sends the ID token. We create or refresh the account and return it.
 * role=partner starts a partner profile (KYC not started) for the partner app.
 */
export const createSession = async (req, res) => {
  const { user: row, isNew } = await users.upsertFromToken(req.auth);
  if (!row.is_active || row.deleted_at) throw forbidden('This account has been deactivated', 'ACCOUNT_DISABLED');

  let account = row;
  if (PARTNER_ROLES.has(req.body.role) && !row.provider) account = await users.ensureProviderProfile(row.id);
  invalidateActor(row.id);

  logger.info('Session created', { uid: row.id, isNew, provider: req.auth.firebase?.sign_in_provider });
  return ok(
    res,
    {
      firebaseUid: row.id,
      isNewUser: isNew || !account.name,
      user: toUser(account, { providerProfile: account.provider }),
    },
    { message: 'Signed in' },
  );
};

/** POST /auth/logout - revoke refresh tokens on every device. */
export const logout = async (req, res) => {
  await revokeSessions(req.actor.id);
  invalidateActor(req.actor.id);
  return ok(res, null, { message: 'Signed out everywhere' });
};

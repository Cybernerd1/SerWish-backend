/**
 * Salted hashes for duplicate checks (the same ID or bank account on two
 * partner accounts). Values are normalised first so spacing and case do not matter.
 */
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

let pepper = env.KYC_HASH_PEPPER;
if (!pepper) {
  pepper = crypto.createHash('sha256').update(`serwish-kyc:${env.SUPABASE_SERVICE_ROLE_KEY}`).digest('hex');
  if (env.NODE_ENV === 'production') {
    logger.warn(
      'KYC_HASH_PEPPER is not set; using a value derived from the service-role key. Set it before partners verify.',
    );
  }
}

const norm = (v) =>
  String(v)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** 64-char hex HMAC-SHA256 of the joined, normalised parts. */
export const kycHash = (...parts) =>
  crypto.createHmac('sha256', pepper).update(parts.map(norm).join('|')).digest('hex');

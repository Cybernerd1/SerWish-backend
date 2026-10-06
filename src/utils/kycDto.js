/**
 * Partner verification state as the app sees it (ApiKyc in the app's api/types.ts).
 * Masked values only: last 4 digits, verified names. Never paths or hashes.
 */
import { env } from '../config/env.js';

export const KYC_CONSENT_VERSION = 'partner-kyc-v1';
export const MAX_SELFIE_ATTEMPTS = 3;

const ok = (s) => s === 'done' || s === 'review';

/** Does any of the partner's categories need a skill certificate? */
export const certRequiredFor = (categorySlugs = []) =>
  categorySlugs.some((s) => env.KYC_CERT_REQUIRED_CATEGORIES.includes(s));

export const toKyc = (profile, k, { digilockerAvailable, certRequired = false }) => {
  const r = k ?? {};
  const consentAccepted = !!r.consent_at && r.consent_version === KYC_CONSENT_VERSION;
  const steps = {
    identity: {
      state: r.id_state ?? 'todo',
      source: r.id_source ?? null,
      docType: r.id_doc_type ?? null,
      name: r.id_name ?? null,
      aadhaarLast4: r.id_aadhaar_last4 ?? null,
      reason: r.id_reason ?? null,
    },
    selfie: {
      state: r.selfie_state ?? 'todo',
      attemptsLeft: Math.max(0, MAX_SELFIE_ATTEMPTS - (r.selfie_attempts ?? 0)),
      reason: r.selfie_reason ?? null,
    },
    bank: {
      state: r.bank_state ?? 'todo',
      holderName: r.bank_name_at_bank ?? r.bank_holder_name ?? null,
      accountLast4: r.bank_account_last4 ?? null,
      ifsc: r.bank_ifsc ?? null,
      reason: r.bank_reason ?? null,
    },
    certificate: { state: r.cert_state ?? 'todo', required: certRequired, reason: r.cert_reason ?? null },
  };
  const missing = [];
  if (!consentAccepted) missing.push('consent');
  if (!ok(steps.identity.state)) missing.push('identity');
  if (!ok(steps.selfie.state)) missing.push('selfie');
  if (!ok(steps.bank.state)) missing.push('bank');
  if (certRequired && !ok(steps.certificate.state)) missing.push('certificate');

  const status = profile.kyc_status;
  const level = status === 'approved' ? 2 : ok(steps.identity.state) ? 1 : 0;
  return {
    status,
    level,
    consent: {
      accepted: consentAccepted,
      acceptedAt: consentAccepted ? r.consent_at : null,
      version: KYC_CONSENT_VERSION,
    },
    digilocker: { available: digilockerAvailable },
    steps,
    canSubmit: ['not_started', 'in_progress', 'rejected'].includes(status) && missing.length === 0,
    missing,
    submittedAt: profile.kyc_submitted_at ?? null,
    reviewedAt: profile.kyc_reviewed_at ?? null,
    rejection:
      status === 'rejected'
        ? {
            reasons: r.rejection_reasons?.length ? r.rejection_reasons : [profile.kyc_rejection_reason].filter(Boolean),
            note: r.rejection_note ?? null,
          }
        : null,
  };
};

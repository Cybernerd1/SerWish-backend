/**
 * Admin review of partner verification (the admin console's KYC module).
 * Every case view and decision is written to kyc_events. Document photos are
 * only ever shared as signed URLs that expire in 5 minutes.
 */
import * as kyc from '../repos/kyc.repo.js';
import { invalidateActor } from '../middleware/auth.js';
import { kycProvider } from '../services/kyc/providers/index.js';
import { kycStorage } from '../services/kyc/storage.js';
import { emitToUser } from '../services/realtime.js';
import { notify } from '../services/notify.js';
import { certRequiredFor, toKyc } from '../utils/kycDto.js';
import { AppError, notFound } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { getOwnProfile } from '../repos/providers.repo.js';
import { SOCKET_EVENTS } from '../config/constants.js';

const SIGNED_URL_SECONDS = 300;

const maskPhone = (p) => (p ? `${p.slice(0, -8).replace(/\d/g, 'x')}${p.slice(-8, -6)}xxxx${p.slice(-2)}` : null);
const slugs = (c) => (c.categories ?? []).map((x) => x.category?.slug).filter(Boolean);

const stateOf = (c) =>
  toKyc(c, c.kyc, { digilockerAvailable: kycProvider().digilockerAvailable, certRequired: certRequiredFor(slugs(c)) });

const summary = (c) => {
  const k = c.kyc ?? {};
  const s = stateOf(c);
  return {
    partnerId: c.user_id,
    name: c.user?.name ?? null,
    phone: maskPhone(c.user?.phone),
    city: c.user?.city ?? null,
    categories: (c.categories ?? []).map((x) => x.category?.name).filter(Boolean),
    status: c.kyc_status,
    submittedAt: c.kyc_submitted_at ?? null,
    flags: k.flags ?? [],
    steps: Object.fromEntries(Object.entries(s.steps).map(([key, v]) => [key, v.state])),
    identitySource: k.id_source ?? null,
  };
};

/** GET /admin/kyc/queue?status=pending - oldest submissions first. */
export const listQueue = async (req, res) => {
  const { status, limit, offset } = req.query;
  const { rows, total } = await kyc.queue({ status, limit, offset });
  return ok(res, rows.map(summary), { meta: { total, limit, offset } });
};

/** GET /admin/kyc/:partnerId - full case with verified fields and short-lived document links. */
export const getCase = async (req, res) => {
  const c = await kyc.getCase(req.params.partnerId);
  if (!c) throw notFound('Partner');
  const k = c.kyc ?? {};
  const store = kycStorage();
  const link = async (path) => (path ? store.signedUrl(path, SIGNED_URL_SECONDS) : null);
  const [idPhoto, idFront, idBack, selfie, certificate, events] = await Promise.all([
    link(k.id_photo_path),
    link(k.id_front_path),
    link(k.id_back_path),
    link(k.selfie_path),
    link(k.cert_path),
    kyc.listEvents(c.user_id, 50),
  ]);
  await kyc.addEvent(c.user_id, { actorId: req.actor.id, kind: 'admin.view', result: 'info' });
  return ok(res, {
    ...summary(c),
    email: c.user?.email ?? null,
    title: c.headline ?? null,
    years: c.years_experience ?? 0,
    joinedAt: c.user?.created_at ?? null,
    kyc: stateOf(c),
    verified: {
      identity: {
        source: k.id_source ?? null,
        docType: k.id_doc_type ?? null,
        name: k.id_name ?? null,
        dob: k.id_dob ?? null,
        gender: k.id_gender ?? null,
        city: k.id_city ?? null,
        state: k.id_state_name ?? null,
        pincode: k.id_pincode ?? null,
        aadhaarLast4: k.id_aadhaar_last4 ?? null,
      },
      selfie: {
        score: k.selfie_score === null || k.selfie_score === undefined ? null : Number(k.selfie_score),
        liveness: k.selfie_liveness ?? null,
        attempts: k.selfie_attempts ?? 0,
      },
      bank: {
        holderName: k.bank_holder_name ?? null,
        nameAtBank: k.bank_name_at_bank ?? null,
        nameScore: k.bank_name_score === null || k.bank_name_score === undefined ? null : Number(k.bank_name_score),
        accountLast4: k.bank_account_last4 ?? null,
        ifsc: k.bank_ifsc ?? null,
      },
    },
    documents: { idPhoto, idFront, idBack, selfie, certificate, expiresInSeconds: SIGNED_URL_SECONDS },
    history: events.map((e) => ({
      kind: e.kind,
      result: e.result,
      detail: e.detail,
      by: e.actor?.name ?? null,
      at: e.created_at,
    })),
  });
};

/** POST /admin/kyc/:partnerId/decision { decision, reasons[], note?, failedSteps[] } */
export const decide = async (req, res) => {
  const partnerId = req.params.partnerId;
  const c = await kyc.getCase(partnerId);
  if (!c) throw notFound('Partner');
  const { decision, reasons, note, failedSteps } = req.body;
  const approve = decision === 'approve';
  if (approve) {
    const s = stateOf(c);
    const open = Object.entries(s.steps).filter(
      ([k, v]) => (k !== 'certificate' || v.required) && !['done', 'review'].includes(v.state),
    );
    if (open.length) {
      throw new AppError(409, 'KYC_INCOMPLETE', `Cannot approve: ${open.map(([k]) => k).join(', ')} not completed.`);
    }
  }
  await kyc.decide({
    partnerId,
    adminId: req.actor.id,
    approve,
    reasons: approve ? [] : reasons,
    note,
    failedSteps: approve ? [] : failedSteps,
  });
  invalidateActor(partnerId);

  const fresh = await getOwnProfile(partnerId);
  const state = toKyc(fresh, await kyc.getKyc(partnerId), {
    digilockerAvailable: kycProvider().digilockerAvailable,
    certRequired: certRequiredFor((fresh.categories ?? []).map((x) => x.category?.slug).filter(Boolean)),
  });
  emitToUser(partnerId, SOCKET_EVENTS.PARTNER_KYC, state);
  await notify(
    partnerId,
    approve
      ? {
          kind: 'update',
          title: 'You are verified',
          body: 'Welcome to SerWish Partner. Go online to start getting jobs near you.',
          data: { screen: 'KycStatus' },
        }
      : {
          kind: 'update',
          title: 'Verification needs changes',
          body: reasons[0] ?? 'Open the app to see what to fix.',
          data: { screen: 'KycStatus' },
        },
  );
  return ok(res, state, { message: approve ? 'Partner approved' : 'Partner asked to fix their verification' });
};

/** Partner verification data. Only the API (service role) reads these tables. */
import { db } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

export const getKyc = async (partnerId) =>
  unwrap(await db().from('partner_kyc').select('*').eq('partner_id', partnerId).maybeSingle());

/** Insert-or-update the partner's row and return it. */
export const saveKyc = async (partnerId, patch) =>
  unwrap(
    await db()
      .from('partner_kyc')
      .upsert({ partner_id: partnerId, ...patch }, { onConflict: 'partner_id' })
      .select('*')
      .single(),
  );

/** First step taken: not_started -> in_progress. */
export const markInProgress = async (partnerId) =>
  unwrap(
    await db()
      .from('provider_profiles')
      .update({ kyc_status: 'in_progress' })
      .eq('user_id', partnerId)
      .eq('kyc_status', 'not_started'),
  );

/** Move to review; null when the status changed meanwhile (already submitted, approved). */
export const submit = async (partnerId) =>
  unwrap(
    await db()
      .from('provider_profiles')
      .update({ kyc_status: 'pending', kyc_submitted_at: new Date().toISOString(), kyc_rejection_reason: null })
      .eq('user_id', partnerId)
      .in('kyc_status', ['not_started', 'in_progress', 'rejected'])
      .select('user_id')
      .maybeSingle(),
  );

/** Another partner already verified with this ID? */
export const idHashOwner = async (hash, exceptPartnerId) =>
  unwrap(
    await db().from('partner_kyc').select('partner_id').eq('id_hash', hash).neq('partner_id', exceptPartnerId).limit(1),
  )[0]?.partner_id ?? null;

export const bankHashUsedElsewhere = async (hash, exceptPartnerId) =>
  unwrap(
    await db()
      .from('partner_kyc')
      .select('partner_id')
      .eq('bank_account_hash', hash)
      .neq('partner_id', exceptPartnerId)
      .limit(1),
  ).length > 0;

/* ---------- DigiLocker sessions ---------- */

export const createSession = async (row) =>
  unwrap(await db().from('kyc_digilocker_sessions').insert(row).select('*').single());

export const getSession = async (partnerId, providerRef) =>
  unwrap(
    await db()
      .from('kyc_digilocker_sessions')
      .select('*')
      .eq('partner_id', partnerId)
      .eq('provider_ref', providerRef)
      .maybeSingle(),
  );

export const updateSession = async (id, patch) =>
  unwrap(await db().from('kyc_digilocker_sessions').update(patch).eq('id', id));

export const countSessionsSince = async (partnerId, since) => {
  const { count, error } = await db()
    .from('kyc_digilocker_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', partnerId)
    .gte('created_at', since.toISOString());
  if (error) unwrap({ error });
  return count ?? 0;
};

/* ---------- History ---------- */

export const addEvent = async (partnerId, { actorId = null, kind, result = 'info', detail = {} }) =>
  unwrap(await db().from('kyc_events').insert({ partner_id: partnerId, actor_id: actorId, kind, result, detail }));

export const listEvents = async (partnerId, limit = 50) =>
  unwrap(
    await db()
      .from('kyc_events')
      .select('id, kind, result, detail, created_at, actor:users!kyc_events_actor_id_fkey(name)')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );

/* ---------- Admin ---------- */

const CASE = `user_id, kyc_status, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, headline, years_experience,
  user:users!provider_profiles_user_id_fkey(name, phone, email, city, photo_url, created_at),
  categories:provider_categories(category:categories(id, slug, name)),
  kyc:partner_kyc(*)`;

export const queue = async ({ status, limit, offset }) => {
  const { data, error, count } = await db()
    .from('provider_profiles')
    .select(CASE, { count: 'exact' })
    .eq('kyc_status', status)
    .order('kyc_submitted_at', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);
  return { rows: unwrap({ data, error }), total: count ?? 0 };
};

export const getCase = async (partnerId) =>
  unwrap(await db().from('provider_profiles').select(CASE).eq('user_id', partnerId).maybeSingle());

export const decide = async ({ partnerId, adminId, approve, reasons, note, failedSteps }) =>
  unwrap(
    await db().rpc('kyc_decide', {
      p_partner_id: partnerId,
      p_admin_id: adminId,
      p_approve: approve,
      p_reasons: reasons,
      p_note: note ?? null,
      p_failed_steps: failedSteps,
    }),
  );

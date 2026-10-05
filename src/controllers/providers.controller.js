import * as providers from '../repos/providers.repo.js';
import * as users from '../repos/users.repo.js';
import { invalidateActor } from '../middleware/auth.js';
import { ratingBreakdown, toOwnPartnerProfile, toProviderCard, toProviderDetail, toReview } from '../utils/dto.js';
import { created, ok } from '../utils/response.js';
import { conflict, notFound, validationFailed } from '../utils/errors.js';
import { RULES } from '../config/constants.js';

/** GET /providers?lat&lng[&category|serviceId][&sort][&onlineOnly] - partners near the customer. */
export const listNearby = async (req, res) => {
  const q = req.query;
  const radiusKm = Math.min(q.radiusKm ?? RULES.matchRadiusKm, RULES.matchRadiusKm * 2);
  const rows = await providers.nearby({ ...q, radiusKm });
  return ok(res, rows.filter((r) => r.provider_id !== req.actor.id).map(toProviderCard), {
    meta: { limit: q.limit, offset: q.offset, radiusKm },
  });
};

export const getProvider = async (req, res) => {
  const profile = await providers.getPublicProfile(req.params.id);
  if (!profile) throw notFound('Partner');
  const [extras, latest] = await Promise.all([
    providers.getProfileExtras(profile.user_id),
    providers.latestReviews(profile.user_id, 5),
  ]);
  return ok(res, {
    ...toProviderDetail({
      profile,
      categories: extras.categories,
      serviceIds: extras.serviceIds,
      gallery: extras.gallery,
      breakdown: ratingBreakdown(extras.ratings),
    }),
    latestReviews: latest.map(toReview),
  });
};

export const listProviderReviews = async (req, res) => {
  const profile = await providers.getPublicProfile(req.params.id);
  if (!profile) throw notFound('Partner');
  const { limit, offset } = req.query;
  const { rows, total } = await providers.listReviews(profile.user_id, { limit, offset });
  return ok(res, rows.map(toReview), { meta: { total, limit, offset } });
};

/* ---------- Partner self-service ---------- */

const resolveCategories = async (slugs) => {
  const rows = await providers.categoryIdsForSlugs(slugs);
  const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length)
    throw validationFailed([{ field: 'body.categorySlugs', message: `Unknown category: ${missing.join(', ')}` }]);
  return rows.map((r) => r.id);
};

const profileFields = (b) => {
  const patch = {};
  if (b.title !== undefined) patch.headline = b.title;
  if (b.bio !== undefined) patch.bio = b.bio;
  if (b.years !== undefined) patch.years_experience = b.years;
  if (b.languages !== undefined) patch.languages = b.languages;
  if (b.pricePerHour !== undefined) patch.hourly_rate = b.pricePerHour;
  if (b.areas !== undefined) patch.service_areas = b.areas;
  return patch;
};

/**
 * POST /providers/register - become a partner (Partner Registration screen).
 * The same account keeps its customer side (roles are never flipped); a
 * profile already under review or approved cannot be re-registered.
 */
export const register = async (req, res) => {
  const me = req.actor.id;
  const current = await providers.getOwnProfile(me);
  if (current && current.kyc_status !== 'not_started') {
    throw conflict('You are already registered as a partner', 'ALREADY_PARTNER');
  }
  const b = req.body;
  const categoryIds = await resolveCategories(b.categorySlugs);
  const userPatch = { name: b.name };
  if (b.city) userPatch.city = b.city;
  if (b.email) userPatch.email = b.email;
  await users.updateProfile(me, userPatch);
  await providers.upsertProfile(me, profileFields(b));
  await providers.setCategories(me, categoryIds);
  invalidateActor(me);
  return created(
    res,
    toOwnPartnerProfile(await providers.getOwnProfile(me)),
    'Welcome to SerWish Partner. Next, verify your KYC.',
  );
};

export const getMe = async (req, res) => {
  const row = await providers.getOwnProfile(req.actor.id);
  if (!row) throw notFound('Partner profile');
  return ok(res, toOwnPartnerProfile(row));
};

export const updateMe = async (req, res) => {
  const me = req.actor.id;
  const b = req.body;
  const patch = profileFields(b);
  if (Object.keys(patch).length) await providers.updateProfile(me, patch);
  if (b.categorySlugs) await providers.setCategories(me, await resolveCategories(b.categorySlugs));
  return ok(res, toOwnPartnerProfile(await providers.getOwnProfile(me)), { message: 'Profile updated' });
};

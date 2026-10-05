import * as catalog from '../repos/catalog.repo.js';
import * as providers from '../repos/providers.repo.js';
import { toCategory, toOffer, toProviderCard, toService } from '../utils/dto.js';
import { ok } from '../utils/response.js';
import { notFound } from '../utils/errors.js';
import { RULES } from '../config/constants.js';
import { env } from '../config/env.js';

/** Public catalogue changes rarely; let clients and CDNs cache it briefly. */
const cache = (res, seconds = 300) =>
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=600`);

export const listCategories = async (_req, res) => {
  const [rows, prices] = await Promise.all([catalog.listCategories(), catalog.priceFromByCategory()]);
  cache(res);
  return ok(
    res,
    rows.map((r) => toCategory(r, prices.get(r.id))),
  );
};

/**
 * GET /categories/:idOrSlug[?lat&lng] - the category, its services and, when a
 * location is given, the top-rated partners nearby (Category screen).
 */
export const getCategory = async (req, res) => {
  const cat = await catalog.getCategory(req.params.idOrSlug);
  if (!cat) throw notFound('Category');
  const { rows } = await catalog.listServices({ categoryId: cat.id, sort: 'popular', limit: 50, offset: 0 });
  const services = rows.map(toService);
  const priceFrom = services.length ? Math.min(...services.map((s) => s.priceFrom)) : undefined;
  let topProviders;
  const { lat, lng } = req.query ?? {};
  if (lat !== undefined && lng !== undefined) {
    const near = await providers.nearby({
      lat,
      lng,
      radiusKm: RULES.matchRadiusKm,
      category: cat.slug,
      sort: 'rating',
      onlineOnly: false,
      limit: 5,
      offset: 0,
    });
    topProviders = near.map(toProviderCard);
  } else {
    cache(res);
  }
  return ok(res, { ...toCategory(cat, priceFrom), services, ...(topProviders && { topProviders }) });
};

export const listServices = async (req, res) => {
  const { category, q, sort, limit, offset } = req.query;
  let categoryId;
  if (category) {
    const cat = await catalog.getCategory(category);
    if (!cat) return ok(res, [], { meta: { total: 0, limit, offset } });
    categoryId = cat.id;
  }
  const { rows, total } = await catalog.listServices({ categoryId, q, sort, limit, offset });
  cache(res, 120);
  return ok(res, rows.map(toService), { meta: { total, limit, offset } });
};

/** GET /services/popular - most booked services for the Home screen. */
export const popularServices = async (req, res) => {
  const { rows } = await catalog.listServices({ sort: 'popular', limit: req.query.limit, offset: 0 });
  cache(res);
  return ok(res, rows.map(toService));
};

export const getService = async (req, res) => {
  const row = await catalog.getService(req.params.idOrSlug);
  if (!row) throw notFound('Service');
  cache(res);
  return ok(res, toService(row));
};

/** GET /search?q= - categories and services matching the words. */
export const search = async (req, res) => {
  const { categories, services } = await catalog.search(req.query.q, req.query.limit);
  cache(res, 60);
  return ok(res, {
    query: req.query.q,
    categories: categories.map((c) => toCategory(c)),
    services: services.map(toService),
  });
};

/** GET /search/suggest?q= - short labels for the search box as the user types. */
export const suggest = async (req, res) => {
  const { categories, services } = await catalog.search(req.query.q, 6);
  const items = [
    ...categories.map((c) => ({ type: 'category', id: c.id, slug: c.slug, label: c.name })),
    ...services.map((s) => ({ type: 'service', id: s.id, slug: s.slug, label: s.name, subtitle: s.subtitle ?? '' })),
  ].slice(0, 8);
  cache(res, 60);
  return ok(res, items);
};

export const listOffers = async (_req, res) => {
  cache(res, 120);
  return ok(res, (await catalog.listActiveOffers()).map(toOffer));
};

/** GET /config - rules the app should not hard-code. */
export const getPublicConfig = (_req, res) => {
  cache(res, 600);
  return ok(res, {
    matchRadiusKm: RULES.matchRadiusKm,
    jobOfferSeconds: RULES.jobOfferSeconds,
    matchingTimeoutSeconds: RULES.matchingTimeoutSeconds,
    platformFee: RULES.platformFeeInr,
    cancellationFee: RULES.cancellationFeeInr,
    walletEnabled: RULES.walletEnabled,
    maxActiveBookings: RULES.maxActiveBookings,
    maxScheduleDays: RULES.maxScheduleDays,
    minScheduleLeadMinutes: RULES.minScheduleLeadMinutes,
    features: { bookings: env.FEATURE_BOOKINGS, payments: env.FEATURE_PAYMENTS, completionOtp: false },
    paymentMethods: env.FEATURE_PAYMENTS ? ['upi', 'card', 'netbanking', 'cash'] : ['upi', 'cash'],
  });
};

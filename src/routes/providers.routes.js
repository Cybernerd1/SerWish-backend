import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/providers.controller.js';
import { getKyc } from '../controllers/kyc.controller.js';
import { authenticate, requirePartner } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { notImplemented } from '../utils/errors.js';
import { firebaseUid, lat, lng, pagination, personName, slug, uuid, validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';

const router = Router();
// Owner decision: no wallet, so no withdrawals. Payouts are settled outside the app for now.
router.post('/withdraw', (_req, res) =>
  res.status(410).json({ success: false, code: 'GONE', message: 'In-app withdrawals are not offered.' }),
);
// Audit BE-X14: partner lists and profiles need a signed-in user (no anonymous scraping).
router.use(authenticate);

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .default('false');

const nearbyQuery = pagination.extend({
  lat,
  lng,
  radiusKm: z.coerce.number().min(0.5).max(25).optional(),
  category: slug.optional(),
  serviceId: uuid.optional(),
  sort: z.enum(['distance', 'rating', 'price']).default('distance'),
  onlineOnly: boolish,
});

const idParam = z.object({ id: firebaseUid });

const profileShape = {
  title: z.string().trim().min(3).max(60).optional(),
  bio: z.string().trim().max(600).optional(),
  years: z.number().int().min(0).max(60).optional(),
  languages: z.array(z.string().trim().min(2).max(30)).max(8).optional(),
  pricePerHour: z.number().int().min(50).max(10000).optional(),
  areas: z.array(z.string().trim().min(2).max(60)).max(20).optional(),
};
const categorySlugs = z
  .array(slug)
  .min(1)
  .max(5)
  .transform((a) => [...new Set(a)]);

const registerBody = z
  .object({
    name: personName,
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    city: z.string().trim().min(2).max(60).optional(),
    categorySlugs,
    ...profileShape,
  })
  .strict();

const updateBody = z.object({ ...profileShape, categorySlugs: categorySlugs.optional() }).strict();

// Partner self-service. Registered before /:id so "me" is never a partner id.
router.post('/register', writeLimiter, validate({ body: registerBody }), asyncHandler(c.register));
router.get('/me', requirePartner, asyncHandler(c.getMe));
router.get('/me/kyc', requirePartner, asyncHandler(getKyc));
router.patch('/me', requirePartner, writeLimiter, validate({ body: updateBody }), asyncHandler(c.updateMe));
router.patch('/profile', requirePartner, writeLimiter, validate({ body: updateBody }), asyncHandler(c.updateMe)); // v1 alias
router.post('/skills', requirePartner, writeLimiter, validate({ body: updateBody }), asyncHandler(c.updateMe)); // v1 alias

// Verification lives in kyc.routes.js. Dashboard and earnings ship in Backend Phase 6.
const later = (feature) => (_req, _res, next) => next(notImplemented(feature, 6));
router.get('/earnings', requirePartner, later('Partner earnings'));
router.get('/me/dashboard', requirePartner, later('Partner dashboard'));

router.get('/', validate({ query: nearbyQuery }), asyncHandler(c.listNearby));
router.get('/:id', validate({ params: idParam }), asyncHandler(c.getProvider));
router.get('/:id/reviews', validate({ params: idParam, query: pagination }), asyncHandler(c.listProviderReviews));

export default router;

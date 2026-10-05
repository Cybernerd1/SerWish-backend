import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/catalog.controller.js';
import { idOrSlug, lat, lng, pagination, validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';

/** Public catalogue: /categories, /services, /offers, /config. */
export const categoriesRouter = Router();
export const servicesRouter = Router();
export const offersRouter = Router();
export const configRouter = Router();
export const searchRouter = Router();

const p = z.object({ idOrSlug });

categoriesRouter.get('/', asyncHandler(c.listCategories));
const nearQuery = z
  .object({ lat: lat.optional(), lng: lng.optional() })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'Send lat and lng together' });
categoriesRouter.get('/:idOrSlug', validate({ params: p, query: nearQuery }), asyncHandler(c.getCategory));

const serviceQuery = pagination.extend({
  category: idOrSlug.optional(),
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'rating']).default('popular'),
});

servicesRouter.get('/', validate({ query: serviceQuery }), asyncHandler(c.listServices));
servicesRouter.get(
  '/popular',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) }) }),
  asyncHandler(c.popularServices),
);
// v1 aliases used by the current app build.
servicesRouter.get('/categories', asyncHandler(c.listCategories));
servicesRouter.get('/categories/:idOrSlug', validate({ params: p, query: nearQuery }), asyncHandler(c.getCategory));
servicesRouter.get('/:idOrSlug', validate({ params: p }), asyncHandler(c.getService));

offersRouter.get('/', asyncHandler(c.listOffers));
configRouter.get('/', c.getPublicConfig);

const searchQuery = z.object({
  q: z.string().trim().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
searchRouter.get('/', validate({ query: searchQuery }), asyncHandler(c.search));
searchRouter.get('/suggest', validate({ query: searchQuery }), asyncHandler(c.suggest));

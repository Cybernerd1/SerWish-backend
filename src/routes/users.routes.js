import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/users.controller.js';
import { authenticate } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { lat, lng, personName, pincode, uuid, validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';

const router = Router();
router.use(authenticate);

const profileBody = z
  .object({
    name: personName.optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    city: z.string().trim().min(2).max(60).optional(),
    photoUrl: z.string().url().startsWith('https://').max(500).nullable().optional(),
  })
  .strict();

const label = z.enum(['home', 'work', 'other', 'Home', 'Work', 'Other']).transform((v) => v.toLowerCase());

const addressBody = z
  .object({
    label: label.default('home'),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(60),
    pincode,
    lat,
    lng,
    isDefault: z.boolean().optional(),
  })
  .strict();

const addressPatch = addressBody
  .partial()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'Send lat and lng together' });

const idParam = z.object({ id: uuid });

router.get('/me', asyncHandler(c.getMe));
router.patch('/me', writeLimiter, validate({ body: profileBody }), asyncHandler(c.updateMe));
router.patch('/profile', writeLimiter, validate({ body: profileBody }), asyncHandler(c.updateMe)); // v1 alias
router.delete('/me', writeLimiter, asyncHandler(c.deleteMe));

router.get('/addresses', asyncHandler(c.listAddresses));
router.post('/addresses', writeLimiter, validate({ body: addressBody }), asyncHandler(c.createAddress));
router.patch(
  '/addresses/:id',
  writeLimiter,
  validate({ params: idParam, body: addressPatch }),
  asyncHandler(c.updateAddress),
);
router.delete('/addresses/:id', writeLimiter, validate({ params: idParam }), asyncHandler(c.deleteAddress));

export default router;

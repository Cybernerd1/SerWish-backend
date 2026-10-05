/**
 * Bookings (Backend Phase 3). Customers create, list, cancel and review;
 * the assigned partner moves the job forward and completes it after payment.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/bookings.controller.js';
import { authenticate, requirePartner } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { pagination, uuid, firebaseUid, validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';
import { AppError } from '../utils/errors.js';

const router = Router();
router.use(authenticate);

const priceInput = {
  serviceId: uuid,
  packageId: uuid.optional(),
  extraIds: z.array(uuid).max(10).default([]),
  couponCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,20}$/, 'Invalid code')
    .optional(),
};

const estimateBody = z.object(priceInput).strict();

const createBody = z
  .object({
    ...priceInput,
    addressId: uuid,
    scheduleType: z.enum(['now', 'later']).default('now'),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    preferredProviderId: firebaseUid.optional(),
    paymentMethod: z.enum(['upi', 'cash', 'card', 'netbanking']).default('upi'),
    notes: z.string().trim().max(500).optional(),
    expectedTotal: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => v.scheduleType === 'now' || !!v.scheduledAt, {
    message: 'scheduledAt is required for later bookings',
    path: ['scheduledAt'],
  });

const listQuery = pagination.extend({
  as: z.enum(['customer', 'partner']).default('customer'),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

const idParam = z.object({ id: uuid });
const cancelBody = z.object({ reason: z.string().trim().min(2).max(300).default('No reason given') }).strict();
const completeBody = z
  .object({
    method: z.enum(['cash', 'upi']),
    amountReceived: z.number().int().min(0),
  })
  .strict();
const reviewBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(6).optional(),
  })
  .strict();

const later = (feature) => (_req, _res, next) =>
  next(new AppError(501, 'NOT_IMPLEMENTED', `${feature} is waiting on an owner decision (completion OTP).`));

router.post('/estimate', validate({ body: estimateBody }), asyncHandler(c.estimateBooking));
router.post('/', writeLimiter, validate({ body: createBody }), asyncHandler(c.createBooking));
router.get('/', validate({ query: listQuery }), asyncHandler(c.listBookings));
router.get('/:id', validate({ params: idParam }), asyncHandler(c.getBooking));
router.post(
  '/:id/cancel',
  writeLimiter,
  validate({ params: idParam, body: cancelBody }),
  asyncHandler(c.cancelBooking),
);
router.delete('/:id', writeLimiter, validate({ params: idParam, body: cancelBody }), asyncHandler(c.cancelBooking)); // v1 alias
router.post(
  '/:id/reschedule',
  writeLimiter,
  validate({ params: idParam, body: z.object({ scheduledAt: z.string().datetime({ offset: true }) }).strict() }),
  asyncHandler(c.rescheduleBooking),
);
router.post(
  '/:id/review',
  writeLimiter,
  validate({ params: idParam, body: reviewBody }),
  asyncHandler(c.reviewBooking),
);

// Partner moves (assigned partner only; the database rejects wrong order).
const partner = [requirePartner, writeLimiter];
router.post('/:id/start-trip', ...partner, validate({ params: idParam }), asyncHandler(c.startTrip));
router.post('/:id/arrive', ...partner, validate({ params: idParam }), asyncHandler(c.arrive));
router.post('/:id/arrived', ...partner, validate({ params: idParam }), asyncHandler(c.arrive)); // v1 alias
router.post('/:id/start', ...partner, validate({ params: idParam }), asyncHandler(c.startJob));
router.post(
  '/:id/complete',
  ...partner,
  validate({ params: idParam, body: completeBody }),
  asyncHandler(c.completeJob),
);
router.post('/:id/accept', ...partner, validate({ params: idParam }), asyncHandler(c.acceptByBooking)); // v1 alias
router.get('/:id/otp', later('The completion code'));
router.post('/:id/verify-otp', later('The completion code'));

export default router;

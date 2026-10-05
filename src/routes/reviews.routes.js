/** v1 alias: POST /reviews { bookingId, rating, comment }. New apps use POST /bookings/:id/review. */
import { Router } from 'express';
import { z } from 'zod';
import { reviewBooking } from '../controllers/bookings.controller.js';
import { authenticate } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { uuid, validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';

const router = Router();
const body = z
  .object({
    bookingId: uuid,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(6).optional(),
  })
  .strict();

router.post(
  '/',
  authenticate,
  writeLimiter,
  validate({ body }),
  (req, _res, next) => {
    req.params.id = req.body.bookingId;
    req.body = { rating: req.body.rating, text: req.body.comment, tags: req.body.tags };
    next();
  },
  asyncHandler(reviewBooking),
);

export default router;

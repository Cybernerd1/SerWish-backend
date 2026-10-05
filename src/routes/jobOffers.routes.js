/** Job offers for partners: GET open offers (missed socket events), accept, decline. */
import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/bookings.controller.js';
import { authenticate, requireApprovedPartner } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { uuid, validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';

const router = Router();
router.use(authenticate, requireApprovedPartner);
const idParam = z.object({ id: uuid });

router.get('/', asyncHandler(c.listMyOffers));
router.get('/:id', validate({ params: idParam }), asyncHandler(c.getOffer));
router.post('/:id/accept', writeLimiter, validate({ params: idParam }), asyncHandler(c.acceptOffer));
router.post('/:id/reject', writeLimiter, validate({ params: idParam }), asyncHandler(c.rejectOffer));

export default router;

/** Admin console API. Every route needs a signed-in admin. */
import { Router } from 'express';
import { z } from 'zod';
import * as kyc from '../controllers/adminKyc.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/response.js';
import { firebaseUid, pagination, validate } from '../utils/validators.js';

const router = Router();
router.use(authenticate, requireAdmin);

const queueQuery = pagination.extend({
  status: z.enum(['pending', 'in_progress', 'rejected', 'approved', 'not_started']).default('pending'),
});
const partnerParam = z.object({ partnerId: firebaseUid });
const STEPS = z.enum(['identity', 'selfie', 'bank', 'certificate']);
const decisionBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reasons: z.array(z.string().trim().min(3).max(160)).max(6).default([]),
    note: z.string().trim().max(1000).optional(),
    failedSteps: z.array(STEPS).max(4).default([]),
  })
  .strict()
  .refine((b) => b.decision === 'approve' || (b.reasons.length > 0 && b.failedSteps.length > 0), {
    message: 'A rejection needs at least one reason and the steps to redo',
    path: ['reasons'],
  });

router.get('/kyc/queue', validate({ query: queueQuery }), asyncHandler(kyc.listQueue));
router.get('/kyc/:partnerId', validate({ params: partnerParam }), asyncHandler(kyc.getCase));
router.post(
  '/kyc/:partnerId/decision',
  writeLimiter,
  validate({ params: partnerParam, body: decisionBody }),
  asyncHandler(kyc.decide),
);

export default router;

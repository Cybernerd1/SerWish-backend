import { Router } from 'express';
import { z } from 'zod';
import { createSession, logout } from '../controllers/auth.controller.js';
import { authenticate, verifyToken } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../utils/validators.js';
import { asyncHandler } from '../utils/response.js';

const router = Router();

const sessionBody = z
  .object({
    role: z.enum(['customer', 'partner', 'seeker', 'provider']).optional(),
    idToken: z.string().max(4096).optional(), // v1 apps only; v2 sends Authorization: Bearer
  })
  .strict();

const session = [authLimiter, validate({ body: sessionBody }), verifyToken, asyncHandler(createSession)];

router.post('/session', ...session);
// v1 aliases kept so installed test builds keep working.
router.post('/verify-phone', ...session);
router.post('/verify-email', ...session);
router.post('/google', ...session);

router.post('/logout', authenticate, asyncHandler(logout));

export default router;

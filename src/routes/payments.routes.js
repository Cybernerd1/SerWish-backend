/**
 * Online payments (Razorpay orders, webhook) ship in Backend Phase 5. Cash and
 * UPI paid to the partner are confirmed through POST /bookings/:id/complete.
 * Owner decision: no wallet, so wallet routes are gone (410), not pending.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { notImplemented } from '../utils/errors.js';

const router = Router();
const gone = (_req, res) =>
  res.status(410).json({ success: false, code: 'GONE', message: 'The SerWish wallet is not offered.' });
router.all('/wallet', gone);
router.all('/wallet/*', gone);
router.use(authenticate, (_req, _res, next) => next(notImplemented('Online payments', 5)));
export default router;

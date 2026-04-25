import { Router } from 'express';
import { authenticate, providerOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuidParamValidation } from '../utils/validators.js';
import { query, body } from 'express-validator';
import {
  getNearbyProviders,
  getProviderById,
  updateProviderProfile,
  setProviderSkills,
  uploadKyc,
  getEarnings,
  requestWithdrawal,
} from '../controllers/providers.controller.js';

const router = Router();

// ─── Public routes ────────────────────────────────────────────────────────────
// Public: GET /api/v1/providers
// FIX BUG-014: Made lat and lng required (not optional) to prevent NaN being
// passed to the PostGIS RPC function.
router.get(
  '/',
  [
    query('lat').notEmpty().withMessage('lat is required').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    query('lng').notEmpty().withMessage('lng is required').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    query('category').optional().isString(),
  ],
  validate,
  getNearbyProviders
);

// ─── Protected static sub-routes (MUST be defined before /:id) ───────────────
// FIX BUG-013: Moved all static sub-routes ABOVE the /:id param route.
// Express matches routes in order — /:id would have shadowed /earnings, /profile, etc.

// PATCH /api/v1/providers/profile
router.patch('/profile', authenticate, providerOnly, updateProviderProfile);

// POST /api/v1/providers/skills
router.post('/skills', authenticate, providerOnly, setProviderSkills);

// POST /api/v1/providers/kyc
router.post('/kyc', authenticate, providerOnly, uploadKyc);

// GET /api/v1/providers/earnings
router.get('/earnings', authenticate, providerOnly, getEarnings);

// POST /api/v1/providers/withdraw
router.post(
  '/withdraw',
  authenticate,
  providerOnly,
  [body('amount').isFloat({ min: 1 }).withMessage('amount must be a positive number')],
  validate,
  requestWithdrawal
);

// ─── Dynamic :id route (MUST be last) ─────────────────────────────────────────
// Public: GET /api/v1/providers/:id
router.get('/:id', [uuidParamValidation('id')], validate, getProviderById);

export default router;

import { Router } from 'express';
import {
  verifyPhone,
  verifyEmail,
  googleAuth,
  logout,
} from '../controllers/auth.controller.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { body } from 'express-validator';

const router = Router();

// ─── Firebase ID Token Validation ─────────────────────────────────────────────
const idTokenValidation = body('idToken')
  .notEmpty()
  .withMessage('idToken is required')
  .isString()
  .withMessage('idToken must be a string');

// ─── Phone Auth ───────────────────────────────────────────────────────────────
// Client handles OTP send/verify via Firebase Auth SDK, then sends the
// resulting ID token here for backend verification + user upsert.
router.post(
  '/verify-phone',
  authLimiter,
  [idTokenValidation],
  validate,
  verifyPhone
);

// ─── Email Auth ───────────────────────────────────────────────────────────────
// Client handles email OTP/link via Firebase Auth SDK, then sends the
// resulting ID token here for backend verification + user upsert.
router.post(
  '/verify-email',
  authLimiter,
  [idTokenValidation],
  validate,
  verifyEmail
);

// ─── Google Auth ──────────────────────────────────────────────────────────────
// Client signs in with Google via Firebase Auth SDK, then sends the
// resulting ID token here.
router.post(
  '/google',
  authLimiter,
  [
    idTokenValidation,
    body('role')
      .optional()
      .isIn(['seeker', 'provider'])
      .withMessage('role must be "seeker" or "provider"'),
  ],
  validate,
  googleAuth
);

// ─── Logout ───────────────────────────────────────────────────────────────────
// Revokes all Firebase refresh tokens for the user.
router.post('/logout', authenticate, logout);

export default router;

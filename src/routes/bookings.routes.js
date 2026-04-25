import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuidParamValidation } from '../utils/validators.js';
import { query, body } from 'express-validator';
import {
  createBooking,
  getBookings,
  getBookingById,
  cancelBooking,
  acceptBooking,
  markArrived,
  startService,
  completeService,
  verifyOtp,
  getOtp,
} from '../controllers/bookings.controller.js';

const router = Router();

// All booking routes require authentication
router.use(authenticate);

// POST /api/v1/bookings
// FIX BUG-002: Added input validation for createBooking (previously had none)
router.post(
  '/',
  [
    body('serviceCategoryId').isUUID().withMessage('serviceCategoryId must be a valid UUID'),
    body('addressId').isUUID().withMessage('addressId must be a valid UUID'),
    body('paymentMethod').optional().isIn(['cash', 'wallet', 'card', 'upi']).withMessage('Invalid payment method'),
    body('providerId').optional().isUUID().withMessage('providerId must be a valid UUID'),
  ],
  validate,
  createBooking
);

// GET /api/v1/bookings
router.get('/', [query('status').optional().isIn(['active', 'past']).withMessage('status must be active or past')], validate, getBookings);

// GET /api/v1/bookings/:id
router.get('/:id', [uuidParamValidation()], validate, getBookingById);

// DELETE /api/v1/bookings/:id
router.delete('/:id', [uuidParamValidation()], validate, cancelBooking);

// Provider lifecycle endpoints
router.post('/:id/accept', [uuidParamValidation()], validate, acceptBooking);
router.post('/:id/arrived', [uuidParamValidation()], validate, markArrived);
router.post('/:id/start', [uuidParamValidation()], validate, startService);
router.post('/:id/complete', [uuidParamValidation()], validate, completeService);

// OTP (seeker gets code, provider verifies)
router.get('/:id/otp', [uuidParamValidation()], validate, getOtp);
router.post(
  '/:id/verify-otp',
  [
    uuidParamValidation(),
    body('otp').trim().isLength({ min: 4, max: 4 }).isNumeric().withMessage('OTP must be 4 digits'),
  ],
  validate,
  verifyOtp
);

export default router;

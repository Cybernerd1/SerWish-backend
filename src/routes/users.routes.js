import { Router } from 'express';
import { authenticate, seekerOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { nameValidation, uuidParamValidation } from '../utils/validators.js';
import { body } from 'express-validator';
import {
  getMe,
  updateProfile,
  getAddresses,
  addAddress,
  deleteAddress,
} from '../controllers/users.controller.js';

const router = Router();

// All user routes require authentication
router.use(authenticate);

// GET /api/v1/users/me
router.get('/me', getMe);

// PATCH /api/v1/users/profile
router.patch('/profile', [nameValidation], validate, updateProfile);

// GET /api/v1/users/addresses
router.get('/addresses', seekerOnly, getAddresses);

// POST /api/v1/users/addresses
router.post(
  '/addresses',
  seekerOnly,
  [
    body('label').trim().notEmpty().withMessage('Label is required'),
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    body('fullAddress').trim().notEmpty().withMessage('Full address is required'),
  ],
  validate,
  addAddress
);

// DELETE /api/v1/users/addresses/:id
router.delete('/addresses/:id', seekerOnly, [uuidParamValidation('id')], validate, deleteAddress);

export default router;

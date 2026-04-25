import { validationResult, body, param, query } from 'express-validator';
import { error } from './response.js';

/**
 * Run validation result check — call after express-validator chain.
 * Returns 422 with detailed errors if validation fails.
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return error(res, 'Validation failed', 422, errors.array());
  }
  next();
};

// ─── Reusable Validation Chains ──────────────────────────────────────────────

export const phoneValidation = body('phone')
  .trim()
  .matches(/^[6-9]\d{9}$/)
  .withMessage('Enter a valid 10-digit Indian mobile number');

export const otpValidation = body('otp')
  .trim()
  .isLength({ min: 6, max: 6 })
  .isNumeric()
  .withMessage('OTP must be 6 digits');

export const nameValidation = body('name')
  .optional()
  .trim()
  .isLength({ min: 2, max: 60 })
  .withMessage('Name must be 2–60 characters');

export const emailValidation = body('email')
  .optional()
  .trim()
  .isEmail()
  .normalizeEmail()
  .withMessage('Enter a valid email address');

export const latLngValidation = [
  query('lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  query('lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
];

export const uuidParamValidation = (paramName = 'id') =>
  param(paramName).isUUID().withMessage(`${paramName} must be a valid UUID`);

export const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be ≥ 1'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1–100'),
];

export const ratingValidation = body('rating')
  .isFloat({ min: 1, max: 5 })
  .withMessage('Rating must be between 1 and 5');

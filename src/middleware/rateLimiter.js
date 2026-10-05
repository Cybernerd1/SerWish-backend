/** Rate limits per client IP (trust proxy is configured in app.js). */
import rateLimit from 'express-rate-limit';

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message },
  });

export const apiLimiter = make(60 * 1000, 300, 'Too many requests. Please slow down.');
export const authLimiter = make(15 * 60 * 1000, 30, 'Too many sign-in attempts. Please try again in a few minutes.');
export const writeLimiter = make(60 * 1000, 60, 'Too many changes in a short time. Please wait a moment.');

import { logger } from '../utils/logger.js';

// Fields that may contain sensitive data and should be redacted from logs
const SENSITIVE_FIELDS = ['password', 'token', 'otp', 'refreshToken', 'idToken', 'razorpayPaymentId', 'razorpaySignature'];

/**
 * Recursively redact sensitive keys from an object before logging.
 * FIX SEC-013: Prevents passwords, tokens, and PII from appearing in log files.
 */
const redactSensitive = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      SENSITIVE_FIELDS.includes(key) ? '[REDACTED]' : redactSensitive(value),
    ])
  );
};

/**
 * Global Express error handler.
 * Must be registered LAST with app.use(errorHandler).
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  // FIX SEC-013: Redact sensitive fields from the request body before logging
  logger.error(`[${req.method}] ${req.originalUrl} — ${err.message}`, {
    stack: err.stack,
    body: redactSensitive(req.body),
    params: req.params,
    query: req.query,
  });

  // Handle Supabase / PostgREST errors
  if (err.code && typeof err.code === 'string' && err.code.startsWith('PGRST')) {
    return res.status(400).json({
      success: false,
      message: 'Database error',
      detail: err.message,
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    });
  }

  // Handle multer file size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File too large (max 10MB)' });
  }

  // FIX SEC-012: Default NODE_ENV to 'production' to prevent accidental
  // stack trace leakage when NODE_ENV is not explicitly set.
  const isProduction = (process.env.NODE_ENV || 'production') !== 'development';
  const statusCode = err.statusCode || err.status || 500;
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal server error' : err.message,
    ...(!isProduction && { stack: err.stack }),
  });
};

/** 404 + error handler. Never leaks stack traces or database messages in production. */
import { AppError, fromDbError } from '../utils/errors.js';
import { logger, redact } from '../utils/logger.js';
import { isProd } from '../config/env.js';

export const notFoundHandler = (req, res) =>
  res.status(404).json({ success: false, code: 'ROUTE_NOT_FOUND', message: 'Route not found' });

export const errorHandler = (err, req, res, _next) => {
  // Body parser errors
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, code: 'BAD_JSON', message: 'Request body is not valid JSON' });
  }

  const appErr = err instanceof AppError ? err : fromDbError(err?.cause ?? err);
  if (appErr) {
    if (appErr.status >= 500) logger.error(appErr.message, { path: req.originalUrl, code: appErr.code });
    const body = { success: false, code: appErr.code, message: appErr.message };
    if (Array.isArray(appErr.details)) body.errors = appErr.details;
    else if (appErr.details) body.data = appErr.details;
    return res.status(appErr.status).json(body);
  }

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err?.message}`, {
    requestId: req.id,
    stack: err?.stack,
    query: redact(req.query),
    body: redact(req.body),
  });
  return res.status(500).json({
    success: false,
    code: 'INTERNAL',
    message: 'Something went wrong. Please try again.',
    ...(!isProd && { debug: err?.message }),
  });
};

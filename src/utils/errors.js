/**
 * Typed API errors. Throw these from controllers and repositories; the error
 * handler turns them into `{ success: false, message, code, errors? }`.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationFailed = (details) => new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid', details);
export const unauthorized = (message = 'Please sign in again', code = 'UNAUTHENTICATED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have access to this', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message, code = 'CONFLICT') => new AppError(409, code, message);
export const notImplemented = (feature, phase) =>
  new AppError(
    501,
    'NOT_IMPLEMENTED',
    `${feature} is not available yet.${phase ? ` It ships in Backend Phase ${phase}.` : ''}`,
  );
export const unavailable = (message = 'Service temporarily unavailable') => new AppError(503, 'UNAVAILABLE', message);

/**
 * Map a PostgREST / Postgres error to an AppError, or return null if unknown.
 * Codes: 23505 unique, 23503 FK, 23514 check, P0001 raised business rule, P0002 not found.
 */
export const fromDbError = (err) => {
  if (!err || typeof err !== 'object') return null;
  switch (err.code) {
    case '23505':
      return conflict('This already exists', 'DUPLICATE');
    case '23503':
      return badRequest('A referenced record does not exist');
    case '23514':
    case '22P02':
      return badRequest('Invalid value');
    case 'P0001':
      return conflict(err.message, 'RULE_VIOLATION');
    case 'P0002':
      return notFound();
    case 'PGRST116':
      return notFound();
    default:
      return null;
  }
};

/** Unwrap a supabase-js result: throw on error, return data. */
export const unwrap = ({ data, error }) => {
  if (error) {
    const mapped = fromDbError(error);
    if (mapped) throw mapped;
    const e = new Error(`Database error: ${error.message}`);
    e.cause = error;
    throw e;
  }
  return data;
};

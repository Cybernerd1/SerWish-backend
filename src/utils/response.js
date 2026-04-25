/**
 * Standardized API response helpers.
 * Use these in every controller for consistent response shape.
 */

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {any} data - Payload to return
 * @param {string} message - Human-readable message
 * @param {number} statusCode - HTTP status code (default 200)
 */
export const success = (res, data = null, message = 'Success', statusCode = 200) => {
  const body = { success: true, message };
  if (data !== null) body.data = data;
  return res.status(statusCode).json(body);
};

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {string} message - Error description
 * @param {number} statusCode - HTTP status code (default 400)
 * @param {any} errors - Optional validation errors
 */
export const error = (res, message = 'Something went wrong', statusCode = 400, errors = null) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

/**
 * Send a created (201) response.
 */
export const created = (res, data = null, message = 'Created successfully') =>
  success(res, data, message, 201);

/**
 * Send a not found (404) response.
 */
export const notFound = (res, message = 'Resource not found') =>
  error(res, message, 404);

/**
 * Send an unauthorized (401) response.
 */
export const unauthorized = (res, message = 'Unauthorized') =>
  error(res, message, 401);

/**
 * Send a forbidden (403) response.
 */
export const forbidden = (res, message = 'Forbidden') =>
  error(res, message, 403);

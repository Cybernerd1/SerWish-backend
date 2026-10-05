/**
 * Response envelope used by every endpoint (unchanged from v1 so the app keeps working):
 *   success: { success: true, message, data?, meta? }
 *   error:   { success: false, message, code, errors? }
 */
export const ok = (res, data = null, { message = 'OK', status = 200, meta } = {}) => {
  const body = { success: true, message };
  if (data !== null && data !== undefined) body.data = data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

export const created = (res, data, message = 'Created') => ok(res, data, { message, status: 201 });

export const noContent = (res) => res.status(204).end();

/** Wrap an async handler so rejections reach the error middleware (audit BE-R1). */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

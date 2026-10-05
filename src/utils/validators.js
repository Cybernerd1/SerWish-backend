/**
 * zod schemas and the request validation middleware.
 * validate({ body, query, params }) replaces req.body/query/params with the
 * parsed values, so handlers only ever see clean, typed input.
 */
import { z } from 'zod';
import { validationFailed } from './errors.js';
import { PAGE } from '../config/constants.js';

export const firebaseUid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
export const uuid = z.string().uuid('Invalid id');
export const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'Invalid slug');
export const idOrSlug = z.union([uuid, slug]);
export const lat = z.coerce.number().min(-90).max(90);
export const lng = z.coerce.number().min(-180).max(180);
export const indianPhone = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=[6-9]\d{9}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));
export const pincode = z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');
export const personName = z.string().trim().min(2, 'Name is too short').max(80);

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE.maxSize).default(PAGE.defaultSize),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const toIssues = (error, where) =>
  error.issues.map((i) => ({ field: [where, ...i.path].join('.'), message: i.message }));

export const validate =
  ({ body, query, params } = {}) =>
  (req, _res, next) => {
    const issues = [];
    for (const [where, schema] of [
      ['params', params],
      ['query', query],
      ['body', body],
    ]) {
      if (!schema) continue;
      const result = schema.safeParse(req[where] ?? {});
      if (result.success) {
        // req.query is a getter in Express 5; assign via defineProperty to be safe.
        Object.defineProperty(req, where, { value: result.data, writable: true, configurable: true, enumerable: true });
      } else {
        issues.push(...toIssues(result.error, where));
      }
    }
    if (issues.length) return next(validationFailed(issues));
    return next();
  };

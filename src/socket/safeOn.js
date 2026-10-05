/**
 * Crash-safe socket handlers (audit BE-R1, BE-R2).
 * Every event: validated payload (zod), per-socket rate limit, try/catch, and an
 * optional ack `{ ok: true, data } | { ok: false, code, message }`.
 * A throwing or rejecting handler can never take the process down.
 */
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { SOCKET_EVENTS } from '../config/constants.js';

const buckets = new WeakMap(); // socket -> Map(event -> { tokens, at })

const allow = (socket, event, perMinute) => {
  let map = buckets.get(socket);
  if (!map) buckets.set(socket, (map = new Map()));
  const now = Date.now();
  const b = map.get(event) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    map.set(event, b);
    return false;
  }
  b.tokens -= 1;
  map.set(event, b);
  return true;
};

/**
 * @param {import('socket.io').Socket} socket
 * @param {string} event
 * @param {import('zod').ZodTypeAny | null} schema
 * @param {(payload: any) => Promise<any> | any} handler
 * @param {{ perMinute?: number }} [opts]
 */
export const safeOn = (socket, event, schema, handler, { perMinute = 60 } = {}) => {
  socket.on(event, async (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const reply = (body) => {
      if (ack) ack(body);
      else if (!body.ok) socket.emit(SOCKET_EVENTS.ERROR, { event, code: body.code, message: body.message });
    };
    try {
      if (!allow(socket, event, perMinute))
        return reply({ ok: false, code: 'RATE_LIMITED', message: 'Too many events' });
      let payload = args[0] ?? {};
      if (schema) {
        const parsed = schema.safeParse(payload);
        if (!parsed.success)
          return reply({
            ok: false,
            code: 'VALIDATION_FAILED',
            message: parsed.error.issues[0]?.message ?? 'Invalid payload',
          });
        payload = parsed.data;
      }
      const data = await handler(payload);
      return reply({ ok: true, ...(data !== undefined && { data }) });
    } catch (err) {
      if (err instanceof AppError) return reply({ ok: false, code: err.code, message: err.message });
      logger.error(`Socket handler ${event} failed`, { uid: socket.data.uid, error: err?.message });
      return reply({ ok: false, code: 'INTERNAL', message: 'Something went wrong' });
    }
  });
};

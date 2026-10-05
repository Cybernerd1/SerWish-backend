/**
 * Structured logger. Production writes JSON to stdout (Render/AWS/GCP collect it);
 * development prints readable lines. File logging is opt-in (LOG_TO_FILE=true).
 * Never log tokens, OTPs, keys or full request bodies; use redact() first.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import winston from 'winston';

const level = process.env.LOG_LEVEL || 'info';
const isProd = (process.env.NODE_ENV || 'production') === 'production';
const isTest = process.env.NODE_ENV === 'test';
const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const SECRET_KEYS =
  /^(password|token|idtoken|accesstoken|refreshtoken|authorization|otp|otp_hash|secret|signature|razorpay_signature|private_?key|cookie)$/i;

/** Deep-copy an object with secret-looking keys replaced. */
export const redact = (value, depth = 0) => {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)]),
  );
};

const transports = [
  new winston.transports.Console({
    silent: isTest && !process.env.DEBUG_LOGS,
    format: isProd
      ? combine(timestamp(), errors({ stack: true }), json())
      : combine(
          colorize(),
          timestamp({ format: 'HH:mm:ss' }),
          errors({ stack: true }),
          printf(({ level: l, message, timestamp: t, stack, ...meta }) => {
            const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${t}] ${l}: ${message}${extra}${stack ? `\n${stack}` : ''}`;
          }),
        ),
  }),
];

if (process.env.LOG_TO_FILE === 'true') {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../logs');
  const fileFormat = combine(timestamp(), errors({ stack: true }), json());
  transports.push(
    new winston.transports.File({
      filename: path.join(dir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5e6,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: path.join(dir, 'combined.log'),
      format: fileFormat,
      maxsize: 5e6,
      maxFiles: 3,
    }),
  );
}

export const logger = winston.createLogger({ level, transports });

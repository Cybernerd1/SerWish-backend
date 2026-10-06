/**
 * Validated environment (audit BE-C3).
 * The server refuses to start with a missing or malformed setting instead of
 * failing later on the first request. Import `env` everywhere; never read
 * process.env directly outside this file.
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    LOG_TO_FILE: bool(false),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    // Firebase Admin credentials. Use ONE of:
    //   FIREBASE_SERVICE_ACCOUNT_JSON  raw JSON or base64 of the service-account file (recommended on Render)
    //   GOOGLE_APPLICATION_CREDENTIALS path to the service-account file
    //   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
    FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),

    // Comma-separated origins for browsers (admin dashboard). Mobile apps send no Origin.
    ALLOWED_ORIGINS: list,

    // Marketplace rules (owner decisions, plan doc 2026-10-01).
    MATCH_RADIUS_KM: z.coerce.number().min(0.5).max(25).default(5),
    JOB_OFFER_SECONDS: z.coerce.number().int().min(10).max(300).default(45),
    MATCHING_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(1800).default(300),
    PLATFORM_FEE_INR: z.coerce.number().int().min(0).default(0),
    CANCELLATION_FEE_INR: z.coerce.number().int().min(0).default(0),
    LOCATION_MIN_INTERVAL_MS: z.coerce.number().int().min(1000).default(4000),
    // Dispatcher: how often it runs, and how early a scheduled ("later") job is offered.
    DISPATCH_INTERVAL_MS: z.coerce.number().int().min(500).max(60000).default(2000),
    DISPATCH_LEAD_MINUTES: z.coerce
      .number()
      .int()
      .min(15)
      .max(24 * 60)
      .default(60),
    ENABLE_DISPATCHER: bool(true),
    MAX_ACTIVE_BOOKINGS: z.coerce.number().int().min(1).max(20).default(3),
    MAX_SCHEDULE_DAYS: z.coerce.number().int().min(1).max(60).default(14),

    // Partner verification (KYC).
    //   manual   : no automatic checks; DigiLocker hidden, selfie and bank go to admin review (default)
    //   fake     : simulated DigiLocker / face / bank checks for development and testing
    //   cashfree : Cashfree Secure ID (DigiLocker, face match + liveness, bank account check)
    KYC_PROVIDER: z.enum(['manual', 'fake', 'cashfree']).default('manual'),
    KYC_ALLOW_FAKE_IN_PRODUCTION: bool(false),
    // Secret mixed into ID and bank-account hashes (duplicate-account checks). Set it before the
    // first partner verifies and never change it. Unset: derived from the service-role key (warns at start).
    KYC_HASH_PEPPER: z.string().min(32).optional(),
    // Public https origin of this API, used for the DigiLocker return page (e.g. https://api.serwish.in).
    PUBLIC_API_URL: z.string().url().optional(),
    KYC_FACE_MATCH_THRESHOLD: z.coerce.number().min(0.5).max(0.99).default(0.75),
    KYC_NAME_MATCH_MIN: z.coerce.number().min(0).max(100).default(70),
    // Category slugs whose partners must upload a skill certificate (e.g. electrician,gas-stove).
    KYC_CERT_REQUIRED_CATEGORIES: list,
    CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    CASHFREE_CLIENT_ID: z.string().optional(),
    CASHFREE_CLIENT_SECRET: z.string().optional(),
    CASHFREE_API_VERSION: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2024-12-01'),

    // Feature switches. Online payments (Razorpay) ship in Backend Phase 5.
    FEATURE_BOOKINGS: bool(true),
    FEATURE_PAYMENTS: bool(false),
  })
  .superRefine((v, ctx) => {
    const hasJson = !!v.FIREBASE_SERVICE_ACCOUNT_JSON;
    const hasFile = !!v.GOOGLE_APPLICATION_CREDENTIALS;
    const hasTriple = !!(v.FIREBASE_PROJECT_ID && v.FIREBASE_CLIENT_EMAIL && v.FIREBASE_PRIVATE_KEY);
    if (v.NODE_ENV !== 'test' && !hasJson && !hasFile && !hasTriple) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
        message:
          'Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or the three FIREBASE_* variables.',
      });
    }
    if (v.KYC_PROVIDER === 'cashfree' && !(v.CASHFREE_CLIENT_ID && v.CASHFREE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CASHFREE_CLIENT_ID'],
        message: 'KYC_PROVIDER=cashfree needs CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET.',
      });
    }
    if (v.NODE_ENV === 'production' && v.KYC_PROVIDER === 'fake' && !v.KYC_ALLOW_FAKE_IN_PRODUCTION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KYC_PROVIDER'],
        message: 'KYC_PROVIDER=fake approves anyone. Set KYC_ALLOW_FAKE_IN_PRODUCTION=true only on a test server.',
      });
    }
    if (v.NODE_ENV === 'production' && v.ALLOWED_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALLOWED_ORIGINS'],
        message: '"*" is not allowed in production.',
      });
    }
  });

/** Parse an env object. Exported for tests. */
export const parseEnv = (source) => {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    const err = new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
    err.code = 'INVALID_ENV';
    throw err;
  }
  return Object.freeze(result.data);
};

const TEST_DEFAULTS = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real',
};

export const env = parseEnv(process.env.NODE_ENV === 'test' ? { ...TEST_DEFAULTS, ...process.env } : process.env);

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

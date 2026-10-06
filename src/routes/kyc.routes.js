/**
 * Partner verification, mounted at /providers/kyc (before the providers router).
 * The DigiLocker return page and the fake-provider page are public: the
 * partner arrives there from a browser, without the app's token.
 */
import express, { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/kyc.controller.js';
import { authenticate, requirePartner } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { acceptFiles } from '../services/kyc/files.js';
import { asyncHandler } from '../utils/response.js';
import { validate } from '../utils/validators.js';

const router = Router();

// Public pages
router.get('/digilocker/return', c.digilockerReturn);
router.get('/fake-digilocker', asyncHandler(c.fakeDigilockerPage));
router.post(
  '/fake-digilocker',
  express.urlencoded({ extended: false, limit: '2kb' }),
  asyncHandler(c.fakeDigilockerDecide),
);

router.use(authenticate, requirePartner);

const consentBody = z.object({ version: z.string().trim().min(1).max(40) }).strict();
const completeBody = z
  .object({ verificationId: z.string().regex(/^swdl_[a-f0-9]{24}$/, 'Invalid verification id') })
  .strict();
const idBody = z.object({ docType: z.enum(['pan', 'driving_licence', 'voter_id', 'passport']) });
const bankBody = z
  .object({
    accountNumber: z.string().regex(/^\d{9,18}$/, 'Account numbers have 9 to 18 digits'),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, like SBIN0001234'),
    holderName: z.string().trim().min(3).max(100),
  })
  .strict();

router.post('/consent', writeLimiter, validate({ body: consentBody }), asyncHandler(c.consent));
router.post('/digilocker/start', writeLimiter, asyncHandler(c.startDigilocker));
router.post('/digilocker/complete', writeLimiter, validate({ body: completeBody }), asyncHandler(c.completeDigilocker));
router.post(
  '/identity',
  writeLimiter,
  acceptFiles([
    { name: 'front', required: true },
    { name: 'back', required: false },
  ]),
  validate({ body: idBody }),
  asyncHandler(c.uploadIdentity),
);
router.post('/selfie', writeLimiter, acceptFiles([{ name: 'photo', required: true }]), asyncHandler(c.uploadSelfie));
router.post('/bank', writeLimiter, validate({ body: bankBody }), asyncHandler(c.verifyBank));
router.post(
  '/certificate',
  writeLimiter,
  acceptFiles([{ name: 'file', required: true, pdf: true }]),
  asyncHandler(c.uploadCertificate),
);
router.post('/submit', writeLimiter, asyncHandler(c.submit));
// v1 apps posted documents here; the step-by-step flow replaced it.
router.post('/', (_req, res) =>
  res.status(410).json({ success: false, code: 'GONE', message: 'Update the SerWish app to verify your identity.' }),
);

export default router;

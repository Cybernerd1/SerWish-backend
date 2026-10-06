/**
 * Express app factory. index.js owns the HTTP server, sockets and shutdown;
 * tests import createApp() directly with supertest.
 */
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import providerRoutes from './routes/providers.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import adminRoutes from './routes/admin.routes.js';
import bookingRoutes from './routes/bookings.routes.js';
import paymentRoutes from './routes/payments.routes.js';
import reviewRoutes from './routes/reviews.routes.js';
import jobOfferRoutes from './routes/jobOffers.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import {
  categoriesRouter,
  configRouter,
  offersRouter,
  searchRouter,
  servicesRouter,
} from './routes/services.routes.js';

/**
 * CORS: mobile apps send no Origin header and are always allowed. Browsers
 * (the admin dashboard) must be on ALLOWED_ORIGINS. Shared with Socket.IO.
 */
export const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true);
  if (env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
  return cb(null, false);
};

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.set('x-request-id', req.id);
    next();
  });

  app.use(helmet());
  app.use(cors({ origin: corsOrigin, credentials: true, maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));

  if (env.NODE_ENV !== 'test') {
    app.use(
      morgan(':method :url :status :res[content-length] - :response-time ms', {
        stream: { write: (line) => logger.http(line.trim()) },
        skip: (req) => req.path === '/health',
      }),
    );
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  const api = express.Router();
  api.use(apiLimiter);
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/categories', categoriesRouter);
  api.use('/services', servicesRouter);
  api.use('/offers', offersRouter);
  api.use('/config', configRouter);
  api.use('/search', searchRouter);
  api.use('/providers/kyc', kycRoutes); // before /providers: has public pages
  api.use('/providers', providerRoutes);
  api.use('/bookings', bookingRoutes);
  api.use('/payments', paymentRoutes);
  api.use('/reviews', reviewRoutes);
  api.use('/job-offers', jobOfferRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/admin', adminRoutes);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

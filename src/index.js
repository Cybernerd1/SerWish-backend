import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initSocket } from './socket/index.js';
import { apiLimiter } from './middleware/rateLimiter.js';

// --- Route imports ---
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import serviceRoutes from './routes/services.routes.js';
import providerRoutes from './routes/providers.routes.js';
import bookingRoutes from './routes/bookings.routes.js';
import reviewRoutes from './routes/reviews.routes.js';
import paymentRoutes from './routes/payments.routes.js';

const app = express();
const httpServer = createServer(app);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet());

// FIX SEC-014: Require ALLOWED_ORIGINS to be explicitly set; fallback to empty
// array (deny all) rather than '*', preventing unintended open CORS.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) || [];
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  })
);

// ─── Request Parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── HTTP Logging ─────────────────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (message) => logger.http(message.trim()) },
  })
);

// FIX BUG-015: Apply apiLimiter globally to all routes to prevent flooding.
app.use(apiLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
// FIX SEC-011: Removed env name from health response to prevent info leakage.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/users`, userRoutes);
app.use(`${API}/services`, serviceRoutes);
app.use(`${API}/providers`, providerRoutes);
app.use(`${API}/bookings`, bookingRoutes);
app.use(`${API}/reviews`, reviewRoutes);
app.use(`${API}/payments`, paymentRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  logger.info(` SerWish backend running on port ${PORT} [${process.env.NODE_ENV || 'production'}]`);

  // FIX BUG-007: Initialize Socket.IO AFTER the server starts listening so
  // the httpServer is ready before any socket connections are attempted.
  // Also ensures initSocket() is always called before getIO() can be triggered
  // by an incoming HTTP request.
  initSocket(httpServer);
  logger.info(' Socket.IO initialized after server start');
});

export default app;
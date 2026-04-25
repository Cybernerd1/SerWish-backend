import { Server } from 'socket.io';
import { verifyFirebaseToken } from '../config/firebase.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { registerBookingEvents } from './booking.socket.js';
import { registerLocationEvents } from './location.socket.js';
import { registerChatEvents } from './chat.socket.js';

/** @type {Server} */
let io;

/**
 * Initialize Socket.IO server with Firebase Auth middleware.
 * @param {import('http').Server} httpServer
 */
export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Firebase Auth Middleware ────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication token missing'));

      // Verify Firebase ID token
      const decodedToken = await verifyFirebaseToken(token);

      // Determine role from database
      const { data: providerRecord } = await supabaseAdmin
        .from('providers')
        .select('id')
        .eq('id', decodedToken.uid)
        .maybeSingle();

      // Attach user info to socket
      socket.userId = decodedToken.uid;
      socket.userRole = providerRecord ? 'provider' : 'seeker';
      socket.userName = decodedToken.name || decodedToken.email || 'User';

      next();
    } catch (err) {
      next(new Error('Socket authentication failed'));
    }
  });

  // ─── Connection Handler ───────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`🔌 Socket connected: ${socket.id} [user: ${socket.userId}, role: ${socket.userRole}]`);

    // Join user-specific room for direct messaging
    socket.join(`user:${socket.userId}`);

    // Register domain-specific event handlers
    registerBookingEvents(io, socket);
    registerLocationEvents(io, socket);
    registerChatEvents(io, socket);

    socket.on('disconnect', (reason) => {
      logger.info(`❌ Socket disconnected: ${socket.id} — Reason: ${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error [${socket.id}]: ${err.message}`);
    });
  });

  logger.info('✅ Socket.IO server initialized');
  return io;
};

/**
 * Get the Socket.IO instance (for use in controllers).
 * @returns {Server}
 */
export const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialized. Call initSocket() first.');
  return io;
};

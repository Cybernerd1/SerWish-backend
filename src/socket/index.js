/**
 * Socket.IO server. Auth on the handshake (Firebase ID token in auth.token),
 * one room per user (user:<uid>), booking rooms joined via booking:watch.
 */
import { Server } from 'socket.io';
import { verifyIdToken } from '../config/firebase.js';
import { loadActor, tokenError } from '../middleware/auth.js';
import { corsOrigin } from '../app.js';
import { logger } from '../utils/logger.js';
import { registerLocationEvents } from './location.socket.js';
import { registerBookingEvents } from './booking.socket.js';
import { attachIO } from '../services/realtime.js';

let io = null;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    maxHttpBufferSize: 16 * 1024, // events are tiny; refuse large frames
    pingTimeout: 30_000,
    pingInterval: 25_000,
    connectionStateRecovery: { maxDisconnectionDuration: 60_000, skipMiddlewares: false },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string' || token.length < 20) throw new Error('missing token');
      const decoded = await verifyIdToken(token);
      const actor = await loadActor(decoded.uid);
      if (!actor) throw new Error('no account');
      socket.data.uid = decoded.uid;
      socket.data.actor = actor;
      next();
    } catch (err) {
      const e = new Error('Socket authentication failed');
      e.data = { code: err?.code ? tokenError(err).code : 'UNAUTHENTICATED' };
      next(e);
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.uid;
    socket.join(`user:${uid}`);
    registerLocationEvents(io, socket);
    registerBookingEvents(io, socket);
    socket.on('error', (err) => logger.warn('Socket error', { uid, error: err?.message }));
  });

  attachIO(io);
  logger.info('Socket.IO ready');
  return io;
};

export const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialised');
  return io;
};

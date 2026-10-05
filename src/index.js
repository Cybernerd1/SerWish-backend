/**
 * Process entry: validates env (on import), initialises Firebase, starts HTTP
 * + Socket.IO, and shuts down cleanly on SIGTERM (Render/containers).
 */
import { createServer } from 'node:http';
import { env } from './config/env.js';
import { initFirebase } from './config/firebase.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';
import { initSocket } from './socket/index.js';
import { startDispatcher, stopDispatcher } from './services/dispatcher.js';

// Audit BE-C8: never die silently on a stray promise; log and exit for unknown state.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.stack : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, exiting', { stack: err.stack });
  process.exit(1);
});

initFirebase();

const app = createApp();
const server = createServer(app);
const io = initSocket(server);

server.keepAliveTimeout = 65_000; // above common load balancer idle timeouts
server.headersTimeout = 66_000;

server.listen(env.PORT, () => {
  logger.info(`SerWish API listening on :${env.PORT} (${env.NODE_ENV})`);
  if (env.ENABLE_DISPATCHER) startDispatcher();
});

let closing = false;
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  // Finish the current dispatcher tick, then close sockets and the HTTP server.
  stopDispatcher().finally(() =>
    io.close(() => {
      logger.info('Shutdown complete');
      process.exit(0);
    }),
  );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

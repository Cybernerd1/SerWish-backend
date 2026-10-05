/**
 * Thin emit helpers so controllers and the dispatcher never touch Socket.IO
 * directly. No-ops until index.js attaches the server (tests run without it).
 */
let io = null;

export const attachIO = (server) => {
  io = server;
};

export const emitToUser = (uid, event, payload) => {
  if (io && uid) io.to(`user:${uid}`).emit(event, payload);
};

export const emitToBooking = (bookingId, event, payload) => {
  if (io && bookingId) io.to(`booking:${bookingId}`).emit(event, payload);
};

import { supabaseAdmin } from '../config/supabase.js';
import { SOCKET_EVENTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

// FIX SEC-018: Maximum allowed length for a single chat message
const MAX_MESSAGE_LENGTH = 1000;

// FIX SEC-019: Minimum milliseconds between typing indicator DB queries per socket
const TYPING_DB_THROTTLE_MS = 2000;
// Track last typing query timestamp per socket+booking combo
const typingThrottle = new Map();

/**
 * Register all chat-related Socket.IO events.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export const registerChatEvents = (io, socket) => {

  // ─── Send chat message ────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async ({ bookingId, text }) => {
    try {
      if (!bookingId || !text?.trim()) return;

      // FIX SEC-018: Reject oversized messages to prevent memory exhaustion
      if (text.length > MAX_MESSAGE_LENGTH) {
        return socket.emit('error', { message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      }

      // Verify the sender is part of this booking
      const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .select('seeker_id, provider_id, status')
        .eq('id', bookingId)
        .single();

      if (error || !booking) return socket.emit('error', { message: 'Booking not found' });

      const isSeeker = booking.seeker_id === socket.userId;
      const isProvider = booking.provider_id === socket.userId;

      if (!isSeeker && !isProvider) {
        return socket.emit('error', { message: 'Not authorized for this booking chat' });
      }

      // Persist message to DB
      const { data: message, error: insertError } = await supabaseAdmin
        .from('messages')
        .insert({
          booking_id: bookingId,
          sender_id: socket.userId,
          sender_role: socket.userRole,
          text: text.trim(),
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Relay to the other party
      const recipientId = isSeeker ? booking.provider_id : booking.seeker_id;

      const payload = {
        id: message.id,
        bookingId,
        senderId: socket.userId,
        senderRole: socket.userRole,
        text: message.text,
        createdAt: message.created_at,
      };

      // Send to recipient
      io.to(`user:${recipientId}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, payload);

      // Echo back to sender with DB-generated ID
      socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, { ...payload, ownMessage: true });

      logger.debug(`Chat: [${socket.userId}] → [${recipientId}] in booking ${bookingId}`);
    } catch (err) {
      logger.error(`chat_message error: ${err.message}`);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // ─── Typing indicators ────────────────────────────────────────────────────
  // FIX SEC-019: Throttle DB queries for typing events — at most one DB query
  // per TYPING_DB_THROTTLE_MS per socket+booking pair to prevent DB flooding.
  const getTypingRecipient = async (bookingId) => {
    const throttleKey = `${socket.id}:${bookingId}`;
    const now = Date.now();
    const lastCall = typingThrottle.get(throttleKey) || 0;

    if (now - lastCall < TYPING_DB_THROTTLE_MS) {
      return null; // Throttled — skip the DB query
    }
    typingThrottle.set(throttleKey, now);

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('seeker_id, provider_id')
      .eq('id', bookingId)
      .single();

    if (!booking) return null;
    return booking.seeker_id === socket.userId ? booking.provider_id : booking.seeker_id;
  };

  socket.on(SOCKET_EVENTS.TYPING_START, async ({ bookingId }) => {
    try {
      const recipientId = await getTypingRecipient(bookingId);
      if (!recipientId) return;

      io.to(`user:${recipientId}`).emit(SOCKET_EVENTS.TYPING_START, {
        bookingId,
        userId: socket.userId,
        role: socket.userRole,
      });
    } catch (_) {}
  });

  socket.on(SOCKET_EVENTS.TYPING_STOP, async ({ bookingId }) => {
    try {
      const recipientId = await getTypingRecipient(bookingId);
      if (!recipientId) return;

      io.to(`user:${recipientId}`).emit(SOCKET_EVENTS.TYPING_STOP, {
        bookingId,
        userId: socket.userId,
      });
    } catch (_) {}
  });

  // Clean up throttle map on disconnect
  socket.on('disconnect', () => {
    for (const key of typingThrottle.keys()) {
      if (key.startsWith(`${socket.id}:`)) {
        typingThrottle.delete(key);
      }
    }
  });
};

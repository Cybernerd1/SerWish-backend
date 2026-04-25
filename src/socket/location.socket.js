import { supabaseAdmin } from "../config/supabase.js";
import { SOCKET_EVENTS } from "../config/constants.js";
import { logger } from "../utils/logger.js";

// In-memory map: providerId → { socketId, currentBookingId }
// Used to relay location ONLY to the matched seeker
const providerSocketMap = new Map();

/**
 * Register all location-related Socket.IO events.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export const registerLocationEvents = (io, socket) => {
  if (socket.userRole !== "provider") return;

  // ─── Provider goes online ─────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GO_ONLINE, async ({ lat, lng }) => {
    try {
      await supabaseAdmin
        .from("providers")
        .update({
          is_online: true,
          current_location: `POINT(${lng} ${lat})`,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", socket.userId);

      // FIX BUG-031: Disconnect stale socket entry if provider reconnects
      const existing = providerSocketMap.get(socket.userId);
      if (existing && existing.socketId !== socket.id) {
        logger.warn(`Provider ${socket.userId} reconnected — stale socket ${existing.socketId} replaced`);
      }

      providerSocketMap.set(socket.userId, {
        socketId: socket.id,
        bookingId: null,
      });

      // Join the online providers room (used for broadcasting new jobs)
      socket.join("online_providers");

      logger.info(`Provider ${socket.userId} went ONLINE at (${lat}, ${lng})`);
    } catch (err) {
      logger.error(`go_online error: ${err.message}`);
    }
  });

  // ─── Provider goes offline ────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.GO_OFFLINE, async () => {
    try {
      await supabaseAdmin
        .from("providers")
        .update({ is_online: false })
        .eq("id", socket.userId);

      providerSocketMap.delete(socket.userId);
      socket.leave("online_providers");

      logger.info(`Provider ${socket.userId} went OFFLINE`);
    } catch (err) {
      logger.error(`go_offline error: ${err.message}`);
    }
  });

  // ─── Real-time location update (every 5 seconds) ──────────────────────────
  socket.on(SOCKET_EVENTS.LOCATION_UPDATE, async ({ lat, lng, bookingId }) => {
    try {
      // Update DB with latest coordinates
      await supabaseAdmin
        .from("providers")
        .update({ current_location: `POINT(${lng} ${lat})` })
        .eq("id", socket.userId);

      // If provider is on an active booking, relay location to the matched seeker ONLY
      if (bookingId) {
        const { data: booking } = await supabaseAdmin
          .from("bookings")
          .select("seeker_id")
          .eq("id", bookingId)
          .eq("provider_id", socket.userId)
          .single();

        if (booking?.seeker_id) {
          io.to(`user:${booking.seeker_id}`).emit(
            SOCKET_EVENTS.PROVIDER_LOCATION,
            {
              lat,
              lng,
              bookingId,
              timestamp: Date.now(),
            }
          );
        }
      }
    } catch (err) {
      logger.error(`location_update error: ${err.message}`);
    }
  });

  // ─── Cleanup on disconnect ───────────────────────────────────────────────
  socket.on("disconnect", async () => {
    // FIX BUG-031: Only clean up if this socket is the current registered one
    // (not if a newer connection replaced it)
    const entry = providerSocketMap.get(socket.userId);
    if (entry && entry.socketId === socket.id) {
      providerSocketMap.delete(socket.userId);
      await supabaseAdmin
        .from("providers")
        .update({ is_online: false })
        .eq("id", socket.userId)
        .catch(() => {}); // silent fail on disconnect
    }
  });
};

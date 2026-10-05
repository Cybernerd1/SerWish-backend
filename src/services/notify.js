/**
 * In-app notifications (the Notifications screen) plus a live socket ping.
 * Best effort: a failed notification never fails the booking action.
 * Push (FCM) is added with device tokens in Backend Phase 7.
 */
import { db } from '../config/supabase.js';
import { SOCKET_EVENTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { toNotification } from '../utils/dto.js';
import { emitToUser } from './realtime.js';

export const notify = async (userId, { kind, title, body, data = {} }) => {
  if (!userId) return;
  try {
    const { data: row, error } = await db()
      .from('notifications')
      .insert({ user_id: userId, kind, title, body, data })
      .select('id, kind, title, body, data, read_at, created_at')
      .single();
    if (error) throw error;
    emitToUser(userId, SOCKET_EVENTS.NOTIFICATION_NEW, toNotification(row));
  } catch (err) {
    logger.warn('Notification failed', { userId, kind, error: err?.message });
  }
};

const svc = (b) => b.service?.name ?? 'service';
const proName = (b) => b.provider?.user?.name ?? 'Your professional';

/** Customer-facing message for a booking status, or null for none. */
export const customerMessage = (b, { previousStatus } = {}) => {
  const data = { bookingId: b.id };
  switch (b.status) {
    case 'assigned':
      return {
        kind: 'booking',
        title: 'Professional assigned',
        body: `${proName(b)} will handle your ${svc(b)}.`,
        data: { ...data, icon: 'check' },
      };
    case 'en_route':
      return {
        kind: 'booking',
        title: 'Professional on the way',
        body: `${proName(b)} is on the way for your ${svc(b)}.`,
        data: { ...data, icon: 'onTheWay' },
      };
    case 'arrived':
      return {
        kind: 'booking',
        title: 'Professional has arrived',
        body: `${proName(b)} is at your address.`,
        data: { ...data, icon: 'onTheWay' },
      };
    case 'in_progress':
      return {
        kind: 'booking',
        title: 'Service started',
        body: `Your ${svc(b)} has started.`,
        data: { ...data, icon: 'check' },
      };
    case 'completed':
      return {
        kind: 'booking',
        title: 'Service completed',
        body: `Your ${svc(b)} is done. Tap to rate your experience.`,
        data: { ...data, icon: 'completed' },
      };
    case 'cancelled':
      return b.cancelled_by === 'customer'
        ? {
            kind: 'booking',
            title: 'Booking cancelled',
            body: `Your ${svc(b)} booking has been cancelled.`,
            data: { ...data, icon: 'cancelled' },
          }
        : {
            kind: 'booking',
            title: 'Booking cancelled',
            body: `Your ${svc(b)} was cancelled by the professional. You were not charged.`,
            data: { ...data, icon: 'cancelled' },
          };
    case 'no_providers':
      return {
        kind: 'booking',
        title: 'No professional available',
        body: `We could not find a professional nearby for your ${svc(b)}. Please try again in a little while.`,
        data: { ...data, icon: 'cancelled' },
      };
    case 'searching':
      return previousStatus && previousStatus !== 'searching'
        ? {
            kind: 'booking',
            title: 'Finding another professional',
            body: `Your professional could not make it. We are finding someone else for your ${svc(b)}.`,
            data: { ...data, icon: 'feature' },
          }
        : null;
    default:
      return null;
  }
};

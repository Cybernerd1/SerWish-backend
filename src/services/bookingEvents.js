/**
 * After any booking change: push the fresh booking to both sides over sockets
 * and write the in-app notification. One place, so every path behaves the same.
 */
import * as bookings from '../repos/bookings.repo.js';
import { SOCKET_EVENTS } from '../config/constants.js';
import { toBooking } from '../utils/dto.js';
import { logger } from '../utils/logger.js';
import { emitToBooking, emitToUser } from './realtime.js';
import { customerMessage, notify } from './notify.js';

/**
 * @param {string} bookingId
 * @param {{ previousStatus?: string, previousProviderId?: string|null, notifyCustomer?: boolean, partnerMessage?: object }} [opts]
 * @returns {Promise<object|null>} the fresh booking row
 */
export const publishBooking = async (bookingId, opts = {}) => {
  try {
    const row = await bookings.getById(bookingId);
    if (!row) return null;
    const customerView = toBooking(row, 'customer');
    emitToUser(row.customer_id, SOCKET_EVENTS.BOOKING_UPDATED, customerView);
    emitToBooking(row.id, SOCKET_EVENTS.BOOKING_UPDATED, customerView);
    if (row.provider_id) emitToUser(row.provider_id, SOCKET_EVENTS.BOOKING_UPDATED, toBooking(row, 'partner'));
    if (opts.previousProviderId && opts.previousProviderId !== row.provider_id) {
      emitToUser(opts.previousProviderId, SOCKET_EVENTS.BOOKING_UPDATED, { id: row.id, status: 'released' });
    }
    if (opts.notifyCustomer !== false && row.status !== opts.previousStatus) {
      const msg = customerMessage(row, { previousStatus: opts.previousStatus });
      if (msg) await notify(row.customer_id, msg);
    }
    if (opts.partnerMessage) {
      await notify(opts.partnerMessage.userId, {
        kind: 'job',
        data: { bookingId: row.id, icon: 'cancelled' },
        ...opts.partnerMessage.msg,
      });
    }
    return row;
  } catch (err) {
    logger.warn('publishBooking failed', { bookingId, error: err?.message });
    return null;
  }
};

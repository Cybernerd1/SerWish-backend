/**
 * Marketplace rules and shared enums. Numbers that the owner may change are
 * read from the environment (see env.js) so no redeploy of code is needed.
 */
import { env } from './env.js';

export const RULES = Object.freeze({
  matchRadiusKm: env.MATCH_RADIUS_KM, // owner decision: 5 km
  jobOfferSeconds: env.JOB_OFFER_SECONDS, // owner decision: 45 s
  matchingTimeoutSeconds: env.MATCHING_TIMEOUT_SECONDS,
  platformFeeInr: env.PLATFORM_FEE_INR, // owner decision: no fee for now
  cancellationFeeInr: env.CANCELLATION_FEE_INR, // owner decision: no fee for now
  walletEnabled: false, // owner decision: no wallet for now
  locationMinIntervalMs: env.LOCATION_MIN_INTERVAL_MS,
  dispatchIntervalMs: env.DISPATCH_INTERVAL_MS,
  dispatchLeadMinutes: env.DISPATCH_LEAD_MINUTES,
  maxActiveBookings: env.MAX_ACTIVE_BOOKINGS,
  maxScheduleDays: env.MAX_SCHEDULE_DAYS,
  minScheduleLeadMinutes: 30, // a "later" slot must be at least 30 minutes away
});

export const PAGE = Object.freeze({ defaultSize: 20, maxSize: 50 });

/** Booking lifecycle (mirrors the booking_status enum in the database). */
export const BOOKING_STATUS = Object.freeze({
  SEARCHING: 'searching',
  ASSIGNED: 'assigned',
  EN_ROUTE: 'en_route',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_PROVIDERS: 'no_providers',
});

export const ACTIVE_BOOKING_STATUSES = Object.freeze(['assigned', 'en_route', 'arrived', 'in_progress']);

export const KYC_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/** Socket.IO event names. See docs/realtime.md. */
export const SOCKET_EVENTS = Object.freeze({
  // client -> server
  PARTNER_ONLINE: 'partner:online',
  PARTNER_OFFLINE: 'partner:offline',
  PARTNER_LOCATION: 'partner:location',
  BOOKING_WATCH: 'booking:watch',
  BOOKING_UNWATCH: 'booking:unwatch',
  // server -> client
  PARTNER_STATE: 'partner:state',
  BOOKING_LOCATION: 'booking:location',
  BOOKING_UPDATED: 'booking:updated',
  JOB_OFFER: 'job:offer',
  JOB_OFFER_CLOSED: 'job:offer_closed',
  NOTIFICATION_NEW: 'notification:new',
  ERROR: 'error:event',
});

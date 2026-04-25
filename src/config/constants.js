// ─── Platform Business Rules ──────────────────────────────────────────────────
export const PLATFORM_FEE_PERCENT = 15; // 15% commission taken from each booking

// ─── Booking Lifecycle Timeouts ───────────────────────────────────────────────
export const MATCHING_TIMEOUT_SECONDS = 90;       // How long to search for a provider
export const JOB_ACCEPT_TIMEOUT_SECONDS = 30;     // How long a provider has to accept
export const FREE_CANCEL_WINDOW_SECONDS = 120;    // 2 minutes free cancellation
export const CANCEL_FEE_INR = 50;                 // Rs. 50 fee after free window

// ─── Location Tracking ────────────────────────────────────────────────────────
export const LOCATION_UPDATE_INTERVAL_MS = 5000;  // Provider GPS update frequency
export const PROVIDER_SEARCH_RADIUS_KM = 3;        // Default provider search radius

// ─── OTP Configuration ───────────────────────────────────────────────────────
export const OTP_EXPIRY_MINUTES = 10;              // OTP valid for 10 minutes
export const OTP_MAX_ATTEMPTS = 3;                 // Wrong OTP attempts before lock
export const OTP_LOCK_MINUTES = 15;                // Lock duration after max attempts
export const OTP_RESEND_COOLDOWN_SECONDS = 30;     // Resend OTP cooldown

// ─── Wallet ───────────────────────────────────────────────────────────────────
export const MIN_WITHDRAWAL_INR = 100;             // Minimum payout amount

// ─── Pagination ───────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── Booking Status Enum ─────────────────────────────────────────────────────
export const BOOKING_STATUS = {
  SEARCHING: 'searching',
  MATCHED: 'matched',
  EN_ROUTE: 'en_route',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

// ─── Payment Status Enum ─────────────────────────────────────────────────────
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  CAPTURED: 'captured',
  REFUNDED: 'refunded',
};

// ─── KYC Status Enum ─────────────────────────────────────────────────────────
export const KYC_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

// ─── User Roles ───────────────────────────────────────────────────────────────
export const USER_ROLE = {
  SEEKER: 'seeker',
  PROVIDER: 'provider',
};

// ─── Socket Events ───────────────────────────────────────────────────────────
export const SOCKET_EVENTS = {
  // Provider → Server
  GO_ONLINE: 'go_online',
  GO_OFFLINE: 'go_offline',
  LOCATION_UPDATE: 'location_update',
  PROVIDER_ARRIVED: 'provider_arrived',
  JOB_STARTED: 'job_started',
  JOB_COMPLETED: 'job_completed',

  // Server → Provider
  NEW_JOB: 'new_job',

  // Server → Seeker
  JOB_ACCEPTED: 'job_accepted',
  JOB_CANCELLED_PROVIDER: 'job_cancelled_provider',
  PROVIDER_LOCATION: 'provider_location',
  BOOKING_STATUS_UPDATE: 'booking_status_update',

  // Bidirectional
  CHAT_MESSAGE: 'chat_message',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
};

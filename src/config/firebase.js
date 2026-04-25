import admin from 'firebase-admin';
import { logger } from '../utils/logger.js';

let firebaseApp;
let _messaging;
let _auth;

/**
 * Lazily initialize Firebase Admin SDK on first use rather than
 * at module load time. This prevents a crash at server startup if Firebase
 * environment variables are missing or malformed.
 */
const getFirebaseApp = () => {
  if (firebaseApp) return firebaseApp;

  const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    const msg = 'Firebase env vars missing (FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL). Firebase services disabled.';
    logger.warn(msg);
    return null;
  }

  try {
    // Parse the private key — env vars escape \n as \\n
    const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: FIREBASE_CLIENT_EMAIL,
      }),
    });

    _messaging = admin.messaging(firebaseApp);
    _auth = admin.auth(firebaseApp);
    logger.info('✅ Firebase Admin SDK initialized');
    return firebaseApp;
  } catch (err) {
    logger.error('❌ Firebase Admin init failed:', err.message);
    return null; // Return null instead of throwing so server still starts
  }
};

/**
 * Get the Firebase Admin app instance. Returns null if Firebase is not
 * configured, so callers must handle the null case gracefully.
 * @returns {admin.app.App | null}
 */
export const firebaseAdmin = {
  get app() { return getFirebaseApp(); },
};

/**
 * Get the Firebase Messaging instance for sending push notifications.
 * Returns null if Firebase is not configured.
 * @returns {admin.messaging.Messaging | null}
 */
export const getMessaging = () => {
  getFirebaseApp(); // Ensure initialized
  return _messaging || null;
};

/**
 * Get the Firebase Auth instance for verifying tokens and managing users.
 * Returns null if Firebase is not configured.
 * @returns {admin.auth.Auth | null}
 */
export const getAuth = () => {
  getFirebaseApp(); // Ensure initialized
  return _auth || null;
};

/**
 * Verify a Firebase ID token and return the decoded token.
 * @param {string} idToken - Firebase ID token from the client
 * @returns {Promise<admin.auth.DecodedIdToken>}
 * @throws {Error} If token is invalid or Firebase is not configured
 */
export const verifyFirebaseToken = async (idToken) => {
  const auth = getAuth();
  if (!auth) {
    throw new Error('Firebase Auth is not configured');
  }
  return auth.verifyIdToken(idToken);
};

/**
 * Get a Firebase user by UID.
 * @param {string} uid - Firebase user UID
 * @returns {Promise<admin.auth.UserRecord>}
 */
export const getFirebaseUser = async (uid) => {
  const auth = getAuth();
  if (!auth) {
    throw new Error('Firebase Auth is not configured');
  }
  return auth.getUser(uid);
};

/**
 * Revoke all refresh tokens for a user (effectively signing them out).
 * @param {string} uid - Firebase user UID
 */
export const revokeFirebaseTokens = async (uid) => {
  const auth = getAuth();
  if (!auth) {
    throw new Error('Firebase Auth is not configured');
  }
  return auth.revokeRefreshTokens(uid);
};

/**
 * Create a custom token for a user (for server-initiated auth flows).
 * @param {string} uid - Firebase user UID
 * @param {object} claims - Optional custom claims
 * @returns {Promise<string>}
 */
export const createCustomToken = async (uid, claims = {}) => {
  const auth = getAuth();
  if (!auth) {
    throw new Error('Firebase Auth is not configured');
  }
  return auth.createCustomToken(uid, claims);
};

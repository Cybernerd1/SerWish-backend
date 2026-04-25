import { supabaseAdmin } from '../config/supabase.js';
import { verifyFirebaseToken, getFirebaseUser, revokeFirebaseTokens } from '../config/firebase.js';
import { success, error } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * POST /api/v1/auth/verify-phone
 *
 * The client uses Firebase Auth SDK to handle phone OTP (send + verify).
 * After successful verification on the client, the client sends the Firebase
 * ID token to this endpoint. The backend verifies the token, upserts the user
 * in the database, and returns user data.
 *
 * Flow:
 *   1. Client calls Firebase signInWithPhoneNumber() → user enters OTP → client gets ID token
 *   2. Client sends { idToken } to this endpoint
 *   3. Backend verifies token → upserts user → returns user data
 */
export const verifyPhone = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    // Verify the Firebase ID token
    const decodedToken = await verifyFirebaseToken(idToken);
    const { uid, phone_number } = decodedToken;

    if (!phone_number) {
      return error(res, 'Token does not contain a phone number', 400);
    }

    // Get the full Firebase user record for metadata
    const firebaseUser = await getFirebaseUser(uid);

    // Upsert user in our `users` table
    const { data: dbUser, error: upsertError } = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: uid,
          phone: phone_number,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (upsertError) {
      logger.error(`User upsert failed: ${upsertError.message}`);
      return error(res, 'Failed to create user record', 500);
    }

    const isNewUser = !dbUser.name; // New user if name not set yet

    logger.info(`Phone auth successful for ${phone_number} (uid: ${uid})`);

    return success(res, {
      firebaseUid: uid,
      isNewUser,
      user: {
        id: dbUser.id,
        phone: dbUser.phone,
        name: dbUser.name,
        profilePhotoUrl: dbUser.profile_photo_url,
        role: 'seeker',
      },
    });
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return error(res, 'Token has expired. Please sign in again.', 401);
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-revoked') {
      return error(res, 'Invalid token', 401);
    }
    next(err);
  }
};

/**
 * POST /api/v1/auth/verify-email
 *
 * The client uses Firebase Auth SDK to handle email OTP/link verification.
 * After successful verification on the client, the client sends the Firebase
 * ID token to this endpoint.
 *
 * Flow:
 *   1. Client calls Firebase signInWithEmailLink() or uses email OTP → gets ID token
 *   2. Client sends { idToken } to this endpoint
 *   3. Backend verifies token → upserts user → returns user data
 */
export const verifyEmail = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    // Verify the Firebase ID token
    const decodedToken = await verifyFirebaseToken(idToken);
    const { uid, email } = decodedToken;

    if (!email) {
      return error(res, 'Token does not contain an email', 400);
    }

    // Get the full Firebase user record
    const firebaseUser = await getFirebaseUser(uid);

    // Upsert user in our `users` table
    const { data: dbUser, error: upsertError } = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: uid,
          email: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (upsertError) {
      logger.error(`User upsert failed: ${upsertError.message}`);
      return error(res, 'Failed to create user record', 500);
    }

    const isNewUser = !dbUser.name;

    logger.info(`Email auth successful for ${email} (uid: ${uid})`);

    return success(res, {
      firebaseUid: uid,
      isNewUser,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        profilePhotoUrl: dbUser.profile_photo_url,
        role: 'seeker',
      },
    });
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return error(res, 'Token has expired. Please sign in again.', 401);
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-revoked') {
      return error(res, 'Invalid token', 401);
    }
    next(err);
  }
};

/**
 * POST /api/v1/auth/google
 *
 * The client uses Firebase Auth SDK to sign in with Google.
 * After successful Google sign-in on the client, the client sends the Firebase
 * ID token to this endpoint.
 *
 * Flow:
 *   1. Client calls Firebase signInWithPopup/signInWithCredential(GoogleAuthProvider)
 *   2. Client gets Firebase ID token
 *   3. Client sends { idToken, role? } to this endpoint
 *   4. Backend verifies token → upserts user → returns user data
 */
export const googleAuth = async (req, res, next) => {
  try {
    const { idToken, role = 'seeker' } = req.body;

    // Verify the Firebase ID token
    const decodedToken = await verifyFirebaseToken(idToken);
    const { uid, email } = decodedToken;

    // Get the full Firebase user record for profile metadata
    const firebaseUser = await getFirebaseUser(uid);

    const displayName = firebaseUser.displayName || decodedToken.name;
    const photoURL = firebaseUser.photoURL || decodedToken.picture;

    // Upsert in correct table based on role
    const table = role === 'provider' ? 'providers' : 'users';
    const { data: dbUser, error: upsertError } = await supabaseAdmin
      .from(table)
      .upsert(
        {
          id: uid,
          email: email,
          name: displayName,
          profile_photo_url: photoURL,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (upsertError) {
      logger.error(`User upsert failed: ${upsertError.message}`);
      return error(res, 'Failed to create user record', 500);
    }

    const isNewUser = !dbUser?.name;

    logger.info(`Google auth successful for ${email} (uid: ${uid}, role: ${role})`);

    return success(res, {
      firebaseUid: uid,
      isNewUser,
      user: {
        id: uid,
        email: email,
        name: dbUser?.name || displayName,
        profilePhotoUrl: dbUser?.profile_photo_url || photoURL,
        role,
      },
    });
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return error(res, 'Token has expired. Please sign in again.', 401);
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/id-token-revoked') {
      return error(res, 'Invalid token', 401);
    }
    next(err);
  }
};

/**
 * POST /api/v1/auth/logout
 *
 * Revokes all Firebase refresh tokens for the user, effectively signing
 * them out from all devices. The client should also call Firebase
 * signOut() locally.
 */
export const logout = async (req, res, next) => {
  try {
    // req.userId comes from the authenticate middleware (Firebase UID)
    await revokeFirebaseTokens(req.userId);
    logger.info(`User ${req.userId} logged out (tokens revoked)`);
    return success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

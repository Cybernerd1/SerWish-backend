import { verifyFirebaseToken } from '../config/firebase.js';
import { supabaseAdmin } from '../config/supabase.js';
import { unauthorized } from '../utils/response.js';

/**
 * Middleware: Verify Firebase ID token and resolve the user's role from the database.
 *
 * The client must include the Firebase ID token in the Authorization header:
 *   Authorization: Bearer <firebase_id_token>
 *
 * The user's role is determined from the database (checks `providers` table first).
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized(res, 'Missing or malformed Authorization header');
    }

    const token = authHeader.split(' ')[1];

    // Verify Firebase ID token — validates signature, expiry, and issuer
    let decodedToken;
    try {
      decodedToken = await verifyFirebaseToken(token);
    } catch (err) {
      if (err.code === 'auth/id-token-expired') {
        return unauthorized(res, 'Token has expired. Please sign in again.');
      }
      if (err.code === 'auth/id-token-revoked') {
        return unauthorized(res, 'Token has been revoked. Please sign in again.');
      }
      return unauthorized(res, 'Invalid or expired token');
    }

    // Attach Firebase user info to the request
    req.user = decodedToken;
    req.userId = decodedToken.uid;

    // Determine role from the database, not from token claims.
    // Check the `providers` table first; if the user exists there, they are a
    // provider. Otherwise they are a seeker.
    const { data: providerRecord } = await supabaseAdmin
      .from('providers')
      .select('id')
      .eq('id', decodedToken.uid)
      .maybeSingle();

    req.role = providerRecord ? 'provider' : 'seeker';

    next();
  } catch (err) {
    return unauthorized(res, 'Authentication failed');
  }
};

/**
 * Middleware: Only allow requests from Seekers.
 * Must be used AFTER authenticate.
 */
export const seekerOnly = (req, res, next) => {
  if (req.role !== 'seeker') {
    return res.status(403).json({ success: false, message: 'Access restricted to Seekers only' });
  }
  next();
};

/**
 * Middleware: Only allow requests from Providers.
 * Must be used AFTER authenticate.
 */
export const providerOnly = (req, res, next) => {
  if (req.role !== 'provider') {
    return res.status(403).json({ success: false, message: 'Access restricted to Providers only' });
  }
  next();
};

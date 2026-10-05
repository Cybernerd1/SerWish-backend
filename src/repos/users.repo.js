/** Users and sessions. All writes go through the service-role client. */
import { db } from '../config/supabase.js';
import { unwrap, conflict } from '../utils/errors.js';

const USER_COLS = 'id, name, email, phone, photo_url, city, is_admin, is_active, created_at, deleted_at';
const WITH_PROFILE = `${USER_COLS}, provider:provider_profiles!provider_profiles_user_id_fkey(user_id, kyc_status)`;

export const findById = async (id) => unwrap(await db().from('users').select(WITH_PROFILE).eq('id', id).maybeSingle());

/** Firebase phone numbers are E.164 (+919876543210); we store the 10-digit form. */
export const normalisePhone = (e164) => {
  if (!e164) return null;
  const m = String(e164).match(/^\+91([6-9]\d{9})$/);
  return m ? m[1] : null;
};

/**
 * Create the user on first sign-in, or refresh the contact fields Firebase
 * vouches for. Never overwrites a name or photo the user set in the app.
 */
export const upsertFromToken = async (decoded) => {
  const phone = normalisePhone(decoded.phone_number);
  const email = decoded.email && decoded.email_verified !== false ? decoded.email.toLowerCase() : null;
  const existing = await findById(decoded.uid);

  if (!existing) {
    const row = {
      id: decoded.uid,
      phone,
      email,
      name:
        typeof decoded.name === 'string' && decoded.name.trim().length >= 2 ? decoded.name.trim().slice(0, 80) : null,
      photo_url: typeof decoded.picture === 'string' ? decoded.picture : null,
    };
    const res = await db().from('users').insert(row).select(WITH_PROFILE).single();
    if (res.error?.code === '23505') {
      // Either a concurrent first sign-in (same uid) or the phone/email belongs to another account.
      const again = await findById(decoded.uid);
      if (again) return { user: again, isNew: false };
      throw conflict('This phone number or email is already linked to another SerWish account.', 'ACCOUNT_CONFLICT');
    }
    return { user: unwrap(res), isNew: true };
  }

  const patch = {};
  if (phone && phone !== existing.phone) patch.phone = phone;
  if (email && email !== existing.email) patch.email = email;
  if (!existing.photo_url && typeof decoded.picture === 'string') patch.photo_url = decoded.picture;
  if (!Object.keys(patch).length) return { user: existing, isNew: false };

  const res = await db().from('users').update(patch).eq('id', decoded.uid).select(WITH_PROFILE).single();
  if (res.error?.code === '23505') {
    throw conflict('This phone number or email is already linked to another SerWish account.', 'ACCOUNT_CONFLICT');
  }
  return { user: unwrap(res), isNew: false };
};

export const updateProfile = async (id, patch) => {
  const res = await db().from('users').update(patch).eq('id', id).select(WITH_PROFILE).single();
  if (res.error?.code === '23505') throw conflict('This phone number or email is already in use.', 'DUPLICATE');
  return unwrap(res);
};

/** Start a partner profile (KYC not started). Idempotent. */
export const ensureProviderProfile = async (id) => {
  unwrap(
    await db().from('provider_profiles').upsert({ user_id: id }, { onConflict: 'user_id', ignoreDuplicates: true }),
  );
  return findById(id);
};

/** Soft-delete: anonymise personal fields; bookings stay for the partner's records. */
export const softDelete = async (id) => {
  unwrap(
    await db()
      .from('users')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        name: null,
        email: null,
        phone: null,
        photo_url: null,
      })
      .eq('id', id),
  );
  unwrap(await db().from('provider_profiles').update({ is_online: false }).eq('user_id', id));
};

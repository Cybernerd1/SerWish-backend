/**
 * Private document storage (Supabase Storage bucket "kyc", never public).
 * Objects are addressed by path; admins get short-lived signed URLs.
 * Tests swap in the in-memory store.
 */
import { db } from '../../config/supabase.js';
import { unavailable } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const BUCKET = 'kyc';

const supabaseStore = {
  put: async (path, buffer, contentType) => {
    const { error } = await db()
      .storage.from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false, cacheControl: 'no-store' });
    if (error) {
      logger.error('KYC upload failed', { path, error: error.message });
      throw unavailable('Could not save the photo. Please try again.');
    }
  },
  get: async (path) => {
    const { data, error } = await db().storage.from(BUCKET).download(path);
    if (error) return null;
    return Buffer.from(await data.arrayBuffer());
  },
  signedUrl: async (path, seconds) => {
    const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, seconds);
    return error ? null : data.signedUrl;
  },
  remove: async (paths) => {
    if (!paths.length) return;
    const { error } = await db().storage.from(BUCKET).remove(paths);
    if (error) logger.warn('KYC delete failed', { count: paths.length, error: error.message });
  },
};

/** In-memory store for tests and local runs without Supabase Storage. */
export const memoryStore = () => {
  const objects = new Map();
  return {
    objects,
    put: async (path, buffer, contentType) => {
      objects.set(path, { buffer, contentType });
    },
    get: async (path) => objects.get(path)?.buffer ?? null,
    signedUrl: async (path, seconds) => (objects.has(path) ? `memory://kyc/${path}?expires=${seconds}` : null),
    remove: async (paths) => paths.forEach((p) => objects.delete(p)),
  };
};

let store = supabaseStore;
export const kycStorage = () => store;
export const __setKycStorageForTests = (s) => {
  store = s ?? supabaseStore;
};

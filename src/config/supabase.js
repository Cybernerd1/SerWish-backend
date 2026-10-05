/**
 * Supabase service-role client. It bypasses Row Level Security, so every
 * access check lives in the API (repositories always filter by the caller).
 * The database itself has RLS on with no policies and no client grants, so a
 * leaked anon key cannot read anything (audit BE-X2).
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
  global: { headers: { 'x-application-name': 'serwish-api' } },
});

/** Always call db() instead of holding the client, so tests can swap it. */
export const db = () => client;

export const __setDbForTests = (fake) => {
  client = fake;
};

import { createClient } from '@supabase/supabase-js';

// ─── Admin Client (for server-side operations bypassing RLS) ─────────────────
// NOTE: The service role key bypasses Row-Level Security entirely.
// Every access control check MUST be enforced in application code.
// Never expose this client or key to the frontend.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// FIX BUG-024: Removed unused public `supabase` (anon key) client.
// If RLS-enforced queries are needed in the future, re-export the anon client
// from this file to make it intentional and documented.

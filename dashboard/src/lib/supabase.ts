import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key && !key.startsWith('YOUR_'));

// Only the browser-safe publishable key is used. All data access is governed by RLS
// and the signed-in caregiver's session.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Throw on Supabase errors so callers can use try/catch uniformly. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const PHOTO_BUCKET = 'patient-photos';

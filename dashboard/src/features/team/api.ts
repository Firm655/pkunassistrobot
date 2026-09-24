import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, unwrap } from '@/lib/supabase';

export interface TeamCodeRow {
  id: string;
  expires_at: string;
  revoked: boolean;
  uses: number;
  created_by: string;
  created_at: string;
}

/** The organization's current code (admins only; the code itself is only shown once, when generated). */
export async function getActiveTeamCode(): Promise<TeamCodeRow | null> {
  const rows = unwrap(await supabase.from('team_codes').select('id, expires_at, revoked, uses, created_by, created_at')
    .eq('revoked', false).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1)) as TeamCodeRow[];
  return rows[0] ?? null;
}

export async function createTeamCode(validDays = 7): Promise<{ code: string; expires_at: string }> {
  return unwrap(await supabase.rpc('create_team_code', { valid_days: validDays })) as { code: string; expires_at: string };
}

export async function revokeTeamCode() {
  unwrap(await supabase.rpc('revoke_team_code'));
}

/** Server-side registration (Edge Function). Public sign-ups stay off; the team code is checked first. */
export async function registerCaregiver(input: { full_name: string; email: string; password: string; team_code: string }) {
  const { error } = await supabase.functions.invoke('register-caregiver', { body: input });
  if (!error) return;
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? 'Registration failed. Try again.');
  }
  throw new Error('Could not reach the server. Check your internet connection and try again.');
}

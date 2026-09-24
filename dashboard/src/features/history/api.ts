import { supabase, unwrap } from '@/lib/supabase';
import type { InteractionLog, PatientResponse } from '@/types/db';

export async function listInteractionLogs(opts: { patientId?: string; from?: string; to?: string; limit?: number } = {}): Promise<InteractionLog[]> {
  let q = supabase.from('interaction_logs').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 300);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.from) q = q.gte('created_at', opts.from);
  if (opts.to) q = q.lte('created_at', opts.to);
  return unwrap(await q) as InteractionLog[];
}

export async function listResponses(opts: { patientId?: string; limit?: number } = {}): Promise<PatientResponse[]> {
  let q = supabase.from('patient_responses').select('*').order('response_time', { ascending: false }).limit(opts.limit ?? 50);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  return unwrap(await q) as PatientResponse[];
}

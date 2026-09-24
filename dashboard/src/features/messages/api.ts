import { supabase, unwrap } from '@/lib/supabase';
import type { Message } from '@/types/db';

export async function listMessages(opts: { patientId?: string; limit?: number; patientRequestsOnly?: boolean; patientResponsesOnly?: boolean; since?: string } = {}): Promise<Message[]> {
  let q = supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.patientRequestsOnly) q = q.eq('message_type', 'PATIENT_REQUEST');
  if (opts.patientResponsesOnly) q = q.eq('sender_type', 'PATIENT');
  if (opts.since) q = q.gte('created_at', opts.since);
  return unwrap(await q) as Message[];
}

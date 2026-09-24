import { supabase, unwrap } from '@/lib/supabase';
import type { Message } from '@/types/db';

export async function listMessages(opts: { patientId?: string; limit?: number; patientRequestsOnly?: boolean; since?: string } = {}): Promise<Message[]> {
  let q = supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.patientRequestsOnly) q = q.eq('message_type', 'PATIENT_REQUEST');
  if (opts.since) q = q.gte('created_at', opts.since);
  return unwrap(await q) as Message[];
}

/** submission_id makes retries idempotent on the server. */
export async function sendCaregiverMessage(patientId: string, message: string, type: 'PRESET' | 'CUSTOM') {
  return unwrap(await supabase.rpc('send_caregiver_message', {
    submission_id: crypto.randomUUID(), patient_id: patientId, message, message_type: type,
  })) as string;
}

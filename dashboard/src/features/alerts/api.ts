import { supabase, unwrap } from '@/lib/supabase';
import type { Alert } from '@/types/db';

export async function listAlerts(opts: { unreviewedOnly?: boolean; patientId?: string; limit?: number; since?: string } = {}): Promise<Alert[]> {
  let q = supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.unreviewedOnly) q = q.eq('reviewed', false);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.since) q = q.gte('created_at', opts.since);
  return unwrap(await q) as Alert[];
}

export async function reviewAlert(id: string) {
  unwrap(await supabase.rpc('review_alert', { alert_id: id }));
}

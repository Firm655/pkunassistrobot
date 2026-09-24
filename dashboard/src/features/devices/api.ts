import { supabase, unwrap } from '@/lib/supabase';
import { DEVICE_STALE_MS } from '@/lib/constants';
import type { Device } from '@/types/db';

export async function listDevices(includeRevoked = false): Promise<Device[]> {
  let q = supabase.from('devices').select('*').order('device_name');
  if (!includeRevoked) q = q.is('revoked_at', null);
  return unwrap(await q) as Device[];
}

export async function createPairingCode(): Promise<{ code: string; expires_at: string }> {
  return unwrap(await supabase.rpc('create_pairing_code')) as { code: string; expires_at: string };
}

export async function updateDevice(id: string, patch: { device_name?: string; assigned_patient_id?: string | null; revoked_at?: string | null }) {
  unwrap(await supabase.from('devices').update(patch).eq('id', id));
}

/** Effective status: trust the server status, but show ONLINE devices with stale heartbeats as offline. */
export function effectiveDeviceStatus(d: Device): 'ONLINE' | 'OFFLINE' | 'PAIRING' {
  if (d.status === 'ONLINE' && (!d.last_seen || Date.now() - new Date(d.last_seen).getTime() > DEVICE_STALE_MS)) return 'OFFLINE';
  return d.status;
}

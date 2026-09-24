import { supabase, unwrap, PHOTO_BUCKET } from '@/lib/supabase';
import type { Patient, Profile } from '@/types/db';

export type PatientInput = Omit<Patient, 'id' | 'organization_id' | 'created_at' | 'updated_at' | 'profile_photo'>;

export async function listPatients(): Promise<Patient[]> {
  return unwrap(await supabase.from('patients').select('*').order('status').order('name')) as Patient[];
}

export async function getPatient(id: string): Promise<Patient | null> {
  return unwrap(await supabase.from('patients').select('*').eq('id', id).maybeSingle()) as Patient | null;
}

export async function createPatient(orgId: string, input: PatientInput): Promise<Patient> {
  return unwrap(await supabase.from('patients').insert({ ...input, organization_id: orgId }).select().single()) as Patient;
}

export async function updatePatient(id: string, input: Partial<PatientInput> & { profile_photo?: string | null }): Promise<Patient> {
  return unwrap(await supabase.from('patients').update(input).eq('id', id).select().single()) as Patient;
}

/** Upload to the private bucket at ORG/PATIENT/RANDOM.ext and store only the object path. */
export async function uploadPatientPhoto(patient: Patient, file: File): Promise<Patient> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Photo must be 5 MB or smaller.');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${patient.organization_id}/${patient.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return updatePatient(patient.id, { profile_photo: path });
}

// Short-lived signed URLs, cached in memory only (never persisted or sent to devices).
const urlCache = new Map<string, { url: string; expires: number }>();
export async function signedPhotoUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function listProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from('profiles').select('*').order('full_name')) as Profile[];
}

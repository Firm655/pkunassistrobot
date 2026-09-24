import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader, Card, Field, ErrorBox, PatientAvatar, Spinner } from '@/components/ui';
import { createPatient, getPatient, updatePatient, uploadPatientPhoto, type PatientInput } from '@/features/patients/api';
import { CARE_NOTE_FIELDS } from '@/features/patients/careNotes';
import type { Patient } from '@/types/db';

const EMPTY: PatientInput = {
  name: '', date_of_birth: null, age: null, assigned_caretaker_id: null, emergency_contact: {}, status: 'ACTIVE',
  special_requirements: null, dietary_requirements: null, food_restrictions: null, allergies: null,
  mobility_notes: null, communication_preferences: null, behavioral_notes: null, other_notes: null,
};

export default function PatientFormPage() {
  const { id } = useParams();
  const { orgId, userId } = useCaregiver();
  const { profiles, reloadPatients } = useReferenceData();
  const navigate = useNavigate();
  const toast = useToast();
  const [existing, setExisting] = useState<Patient | null>(null);
  const [form, setForm] = useState<PatientInput>({ ...EMPTY, assigned_caretaker_id: userId });
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getPatient(id).then((p) => {
      if (!p) { setError('Patient not found.'); return; }
      setExisting(p);
      const { id: _i, organization_id: _o, created_at: _c, updated_at: _u, profile_photo: _p, ...rest } = p;
      setForm({ ...rest, emergency_contact: rest.emergency_contact ?? {} });
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const set = <K extends keyof PatientInput>(k: K, v: PatientInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (v: string) => (v.trim() === '' ? null : v);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const payload = { ...form, name: form.name.trim(), age: form.date_of_birth ? null : form.age };
      let saved = existing ? await updatePatient(existing.id, payload) : await createPatient(orgId, payload);
      if (photo) {
        try { saved = await uploadPatientPhoto(saved, photo); }
        catch (err) { toast({ kind: 'error', title: 'Patient saved, but photo upload failed', body: (err as Error).message }); }
      }
      reloadPatients();
      toast({ kind: 'success', title: existing ? 'Patient updated' : 'Patient created' });
      navigate(`/patients/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={existing ? `Edit ${existing.name}` : 'New patient'}
        actions={<>
          <Link className="btn btn-ghost" to={existing ? `/patients/${existing.id}` : '/patients'}>Cancel</Link>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save patient'}</button>
        </>}
      />
      <ErrorBox error={error} />
      <div className="grid-2">
        <Card title="Basic information">
          <div className="photo-row">
            {preview ? <img className="avatar" src={preview} alt="" style={{ width: 72, height: 72 }} /> : <PatientAvatar patient={existing ?? { name: form.name || '?', profile_photo: null }} size={72} />}
            <label className="btn btn-sm">
              {existing?.profile_photo || photo ? 'Change photo' : 'Upload photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </label>
            <span className="muted small">JPEG, PNG or WebP, up to 5 MB. Stored privately.</span>
          </div>
          <div className="form-grid">
            <Field label="Full name" full><input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} /></Field>
            <Field label="Date of birth"><input type="date" value={form.date_of_birth ?? ''} onChange={(e) => set('date_of_birth', e.target.value || null)} /></Field>
            <Field label="Age" hint={form.date_of_birth ? 'Calculated from date of birth' : 'Use if date of birth is unknown'}>
              <input type="number" min={0} max={130} value={form.age ?? ''} disabled={!!form.date_of_birth} onChange={(e) => set('age', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
            <Field label="Assigned caretaker">
              <select value={form.assigned_caretaker_id ?? ''} onChange={(e) => set('assigned_caretaker_id', e.target.value || null)}>
                <option value="">Unassigned</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => set('status', e.target.value as PatientInput['status'])}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive (hidden from P-kun, schedules paused)</option>
              </select>
            </Field>
          </div>
          <h3 className="section-title">Emergency contact (optional)</h3>
          <div className="form-grid">
            <Field label="Name"><input value={form.emergency_contact.name ?? ''} onChange={(e) => set('emergency_contact', { ...form.emergency_contact, name: e.target.value })} /></Field>
            <Field label="Relationship"><input value={form.emergency_contact.relationship ?? ''} onChange={(e) => set('emergency_contact', { ...form.emergency_contact, relationship: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" value={form.emergency_contact.phone ?? ''} onChange={(e) => set('emergency_contact', { ...form.emergency_contact, phone: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title={<>🔒 Care notes</>} className="card-private">
          <p className="note">Private caretaker information. Never sent to or shown on P-kun.</p>
          <div className="form-grid">
            {CARE_NOTE_FIELDS.map(([key, label]) => (
              <Field key={key} label={label} full>
                <textarea rows={2} value={form[key] ?? ''} onChange={(e) => set(key, text(e.target.value))} />
              </Field>
            ))}
          </div>
        </Card>
      </div>
    </form>
  );
}

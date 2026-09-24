import { useState, type FormEvent } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader, Card, Badge, Field, ErrorBox } from '@/components/ui';
import { supabase, unwrap } from '@/lib/supabase';
import { formatDateTime } from '@/utils/dates';
import type { Role } from '@/types/db';

export default function SettingsPage() {
  const { profile, organization, isAdmin, tz, userId } = useCaregiver();
  const { profiles, reloadProfiles } = useReferenceData();
  const toast = useToast();
  const [form, setForm] = useState({ user_id: '', full_name: '', role: 'caretaker' as Role });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const provision = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      unwrap(await supabase.rpc('provision_caregiver', {
        user_id: form.user_id.trim(), organization_id: organization.id, full_name: form.full_name.trim(), role: form.role,
      }));
      toast({ kind: 'success', title: 'Caregiver added', body: `${form.full_name} can now sign in.` });
      setForm({ user_id: '', full_name: '', role: 'caretaker' });
      reloadProfiles();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Team & settings" />
      <div className="grid-2">
        <Card title="Your profile">
          <dl className="details">
            <dt>Name</dt><dd>{profile.full_name}</dd>
            <dt>Role</dt><dd><Badge tone={isAdmin ? 'info' : 'neutral'}>{isAdmin ? 'Administrator' : 'Caretaker'}</Badge></dd>
            <dt>User ID</dt><dd><code className="small">{userId}</code></dd>
            <dt>Organization</dt><dd>{organization.name}</dd>
            <dt>Timezone</dt><dd>{tz}</dd>
          </dl>
        </Card>
        <Card title="Team">
          <ul className="list">
            {profiles.map((p) => (
              <li key={p.id} className="list-item">
                <div className="grow"><strong>{p.full_name}</strong><div className="muted small">Added {formatDateTime(p.created_at, tz)}</div></div>
                <Badge tone={p.role === 'admin' ? 'info' : 'neutral'}>{p.role === 'admin' ? 'Admin' : 'Caretaker'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        {isAdmin && (
          <Card title="Add caregiver">
            <p className="muted small">
              1. Create the person's account in Supabase Auth (Dashboard → Authentication → Add user). 2. Paste their user ID here.
              They'll see their ID on the “Access not provisioned” screen after signing in. Device accounts cannot become caregivers.
            </p>
            <form onSubmit={provision} className="form-grid">
              <Field label="Auth user ID" full><input value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required pattern="[0-9a-fA-F-]{36}" placeholder="00000000-0000-0000-0000-000000000000" /></Field>
              <Field label="Full name"><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></Field>
              <Field label="Role">
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option value="caretaker">Caretaker</option><option value="admin">Administrator</option>
                </select>
              </Field>
              <div className="field-full"><button className="btn btn-primary" disabled={busy}>Add caregiver</button></div>
            </form>
            <ErrorBox error={error} />
          </Card>
        )}
      </div>
    </>
  );
}

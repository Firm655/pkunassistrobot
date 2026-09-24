import { useEffect, useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useData } from '@/hooks/useData';
import { Card, ErrorBox, Spinner } from '@/components/ui';
import { formatDateTime } from '@/utils/dates';
import { createTeamCode, getActiveTeamCode, revokeTeamCode } from './api';

/** Admin panel: generate / revoke the code new caregivers use on the Register page. */
export function TeamCodeCard() {
  const { tz } = useCaregiver();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data: active, loading, error } = useData(getActiveTeamCode, [version]);
  const [shown, setShown] = useState<{ code: string; expires_at: string } | null>(null);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const registerUrl = `${window.location.origin}/register`;

  useEffect(() => { if (active === null) setShown(null); }, [active]);

  const generate = async () => {
    if (active && !confirm('Generate a new code? The current code will stop working.')) return;
    setBusy(true);
    try { setShown(await createTeamCode(days)); setVersion((v) => v + 1); }
    catch (e) { toast({ kind: 'error', title: 'Could not create a team code', body: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!confirm('Revoke the team code? Nobody will be able to register until you generate a new one.')) return;
    setBusy(true);
    try { await revokeTeamCode(); setShown(null); setVersion((v) => v + 1); toast({ kind: 'success', title: 'Team code revoked' }); }
    catch (e) { toast({ kind: 'error', title: 'Could not revoke', body: (e as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Team code for new caregivers">
      <p className="muted small">
        New staff open <strong>{registerUrl}</strong> (or “Create an account” on the sign-in page) and enter this code.
        They join as caretakers. Only one code is active at a time.
      </p>
      <ErrorBox error={error} />
      {loading ? <Spinner /> : shown ? (
        <>
          <div className="pair-code">
            <code>{shown.code}</code>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(shown.code)}>Copy</button>
          </div>
          <p className="muted small">Valid until {formatDateTime(shown.expires_at, tz)}. Write it down now — for security it is only shown once.</p>
        </>
      ) : active ? (
        <p>
          A code is active until <strong>{formatDateTime(active.expires_at, tz)}</strong> and has been used{' '}
          <strong>{active.uses}</strong> time{active.uses === 1 ? '' : 's'}. The code itself is only shown when generated;
          generate a new one if you've lost it.
        </p>
      ) : (
        <p className="muted">No active code. Nobody can register until you generate one.</p>
      )}
      <div className="row gap-sm wrap" style={{ marginTop: 12 }}>
        <label className="inline-field">Valid for
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option>
          </select>
        </label>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>{active ? 'Generate new code' : 'Generate code'}</button>
        {active && <button className="btn btn-danger-ghost" onClick={revoke} disabled={busy}>Revoke</button>}
      </div>
    </Card>
  );
}

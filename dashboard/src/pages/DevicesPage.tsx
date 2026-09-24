import { useEffect, useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useToast } from '@/contexts/ToastContext';
import { useData } from '@/hooks/useData';
import { PageHeader, Card, Empty, Spinner, ErrorBox, DeviceStatusDot, Badge, Modal } from '@/components/ui';
import { createPairingCode, effectiveDeviceStatus, listDevices, updateDevice } from '@/features/devices/api';
import { formatDateTime, timeAgo } from '@/utils/dates';
import { titleCase } from '@/utils/format';
import type { Device } from '@/types/db';

export default function DevicesPage() {
  const { isAdmin, tz } = useCaregiver();
  const { patients } = useReferenceData();
  const toast = useToast();
  const [showRevoked, setShowRevoked] = useState(false);
  const { data, loading, error } = useData(() => listDevices(showRevoked), [showRevoked], ['devices']);
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);

  // Re-render every 20 s so "last seen" and stale-heartbeat status stay current.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(t); }, []);

  const run = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id);
    try { await fn(); toast({ kind: 'success', title: ok }); }
    catch (e) { toast({ kind: 'error', title: 'Action failed', body: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const genCode = async () => {
    setBusy('pair');
    try { setPairing(await createPairingCode()); }
    catch (e) { toast({ kind: 'error', title: 'Could not create pairing code', body: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const assignedTo = new Map((data ?? []).filter((d) => d.assigned_patient_id && !d.revoked_at).map((d) => [d.assigned_patient_id!, d.id]));

  return (
    <>
      <PageHeader title="P-kun devices" subtitle="Pair devices, assign them to patients and monitor their status."
        actions={isAdmin && <button className="btn btn-primary" onClick={genCode} disabled={busy === 'pair'}>+ Generate pairing code</button>} />
      {!isAdmin && <p className="note">Only administrators can pair, assign or revoke devices. You can view device status.</p>}
      <div className="filters">
        <label className="chip chip-check"><input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show revoked devices</label>
      </div>
      <ErrorBox error={error} />
      {loading ? <Spinner /> : !data?.length ? (
        <Card><Empty>No devices yet. {isAdmin ? 'Generate a pairing code and enter it on the P-kun device.' : 'Ask an administrator to pair one.'}</Empty></Card>
      ) : (
        <div className="device-grid">
          {data.map((d) => (
            <DeviceCard key={d.id} d={d} tz={tz} isAdmin={isAdmin} busy={busy === d.id}
              patients={patients.filter((p) => p.status === 'ACTIVE' && (!assignedTo.has(p.id) || assignedTo.get(p.id) === d.id))}
              onAssign={(pid) => run(d.id, () => updateDevice(d.id, { assigned_patient_id: pid }), pid ? 'Device assigned' : 'Device unassigned')}
              onRename={(name) => run(d.id, () => updateDevice(d.id, { device_name: name }), 'Device renamed')}
              onRevoke={() => confirm(`Revoke ${d.device_name}? It will immediately lose access and must be re-paired.`) &&
                run(d.id, () => updateDevice(d.id, { revoked_at: new Date().toISOString(), assigned_patient_id: null }), 'Device revoked')}
            />
          ))}
        </div>
      )}
      {pairing && <PairingModal code={pairing} tz={tz} onClose={() => setPairing(null)} />}
    </>
  );
}

function DeviceCard({ d, tz, isAdmin, busy, patients, onAssign, onRename, onRevoke }: {
  d: Device; tz: string; isAdmin: boolean; busy: boolean; patients: { id: string; name: string }[];
  onAssign: (pid: string | null) => void; onRename: (n: string) => void; onRevoke: () => void;
}) {
  const { patientMap } = useReferenceData();
  const [name, setName] = useState(d.device_name);
  const caps = Object.entries(d.capabilities ?? {}).filter(([, v]) => v);
  const status = effectiveDeviceStatus(d);
  return (
    <Card className={d.revoked_at ? 'card-muted' : ''} title={<span className="row gap-sm">🤖 {d.device_name}</span>}
      actions={d.revoked_at ? <Badge tone="muted">Revoked</Badge> : <DeviceStatusDot status={status} />}>
      <dl className="details">
        <dt>Assigned patient</dt>
        <dd>
          {isAdmin && !d.revoked_at ? (
            <select value={d.assigned_patient_id ?? ''} disabled={busy} onChange={(e) => onAssign(e.target.value || null)}>
              <option value="">Unassigned</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : d.assigned_patient_id ? patientMap.get(d.assigned_patient_id)?.name ?? '—' : 'Unassigned'}
        </dd>
        <dt>Last seen</dt><dd title={formatDateTime(d.last_seen, tz)}>{timeAgo(d.last_seen)}</dd>
        <dt>App version</dt><dd>{d.app_version ?? '—'}</dd>
        <dt>Capabilities</dt>
        <dd className="row wrap gap-sm">{caps.length ? caps.map(([k]) => <Badge key={k}>{titleCase(k)}</Badge>) : <span className="muted">Not reported</span>}</dd>
        <dt>Paired</dt><dd>{formatDateTime(d.created_at, tz)}</dd>
      </dl>
      {status === 'OFFLINE' && d.assigned_patient_id && !d.revoked_at && (
        <p className="note small">No heartbeat recently. Scheduled events are still stored and will sync when P-kun reconnects.</p>
      )}
      {isAdmin && !d.revoked_at && (
        <div className="row gap-sm wrap device-actions">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Device name" />
          <button className="btn btn-sm" disabled={busy || !name.trim() || name === d.device_name} onClick={() => onRename(name.trim())}>Rename</button>
          <div className="spacer" />
          <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={onRevoke}>Revoke</button>
        </div>
      )}
    </Card>
  );
}

function PairingModal({ code, tz, onClose }: { code: { code: string; expires_at: string }; tz: string; onClose: () => void }) {
  const [left, setLeft] = useState(() => new Date(code.expires_at).getTime() - Date.now());
  useEffect(() => { const t = setInterval(() => setLeft(new Date(code.expires_at).getTime() - Date.now()), 1000); return () => clearInterval(t); }, [code.expires_at]);
  const expired = left <= 0;
  const mm = Math.max(0, Math.floor(left / 60000)), ss = Math.max(0, Math.floor((left % 60000) / 1000));
  return (
    <Modal title="Pairing code" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p>On the P-kun setup screen, enter this code with the keypad:</p>
      <div className={`pair-code ${expired ? 'expired' : ''}`}>
        <code aria-label={code.code.split('').join(' ')}>{code.code.slice(0, 3)} {code.code.slice(3)}</code>
        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(code.code)}>Copy</button>
      </div>
      <p className={expired ? 'error-text' : 'muted'}>
        {expired ? 'This code has expired. Generate a new one.' : `Single use · expires in ${mm}:${String(ss).padStart(2, '0')} (at ${formatDateTime(code.expires_at, tz)}).`}
      </p>
      <p className="muted small">Generating another code cancels this one. After 5 wrong tries, P-kun must wait 10 minutes.</p>
      <p className="muted small">After pairing, the new device appears on this page — assign it to a patient to start syncing their schedule.</p>
    </Modal>
  );
}

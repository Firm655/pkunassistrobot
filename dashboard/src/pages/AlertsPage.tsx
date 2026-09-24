import { useState } from 'react';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { PageHeader, Card, Empty, Spinner, ErrorBox, Tabs } from '@/components/ui';
import { ALERT_TYPE_LABEL } from '@/lib/constants';
import { listAlerts, reviewAlert } from '@/features/alerts/api';
import { AlertRow } from '@/features/alerts/AlertRow';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';
import type { AlertType, Priority } from '@/types/db';

type View = 'open' | 'all';

export default function AlertsPage() {
  const { patients } = useReferenceData();
  const [view, setView] = useState<View>('open');
  const [patient, setPatient] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [type, setType] = useState<AlertType | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useData(
    () => listAlerts({ unreviewedOnly: view === 'open', patientId: patient || undefined, limit: 300 }),
    [view, patient], ['alerts'],
  );
  const rank: Record<Priority, number> = { HIGH: 0, ATTENTION: 1, NORMAL: 2 };
  const rows = (data ?? [])
    .filter((a) => !priority || a.priority === priority)
    .filter((a) => !type || a.alert_type === type)
    .sort((a, b) => (view === 'open' ? rank[a.priority] - rank[b.priority] : 0) || b.created_at.localeCompare(a.created_at));

  const reviewAll = async () => {
    if (!confirm(`Mark ${rows.length} alert(s) as reviewed?`)) return;
    setBusy(true);
    try { for (const a of rows) if (!a.reviewed) await reviewAlert(a.id); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Alerts" subtitle="Situations that need a caretaker's attention. Updates live." />
      <div className="filters">
        <select value={patient} onChange={(e) => setPatient(e.target.value)} aria-label="Patient">
          <option value="">All patients</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')} aria-label="Priority">
          <option value="">All priorities</option>
          <option value="HIGH">High</option><option value="ATTENTION">Attention</option><option value="NORMAL">Normal</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as AlertType | '')} aria-label="Alert type">
          <option value="">All alert types</option>
          {Object.entries(ALERT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="spacer" />
        {view === 'open' && rows.length > 1 && <button className="btn" onClick={reviewAll} disabled={busy}>Mark all shown as reviewed</button>}
      </div>
      <Tabs<View> value={view} onChange={setView} tabs={[{ id: 'open', label: 'Needs review' }, { id: 'all', label: 'All alerts' }]} />
      <ErrorBox error={error} />
      <Card>
        {loading ? <Spinner /> : rows.length === 0 ? <Empty>{view === 'open' ? 'All caught up — no alerts need review.' : 'No alerts.'}</Empty> : (
          <ul className="list">{rows.map((a) => <AlertRow key={a.id} alert={a} onOpenEvent={setOpenId} />)}</ul>
        )}
      </Card>
      {openId && <EventDetailsModal eventId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

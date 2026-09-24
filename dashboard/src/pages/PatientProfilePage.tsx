import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Card, PageHeader, PatientAvatar, Badge, Tabs, Spinner, Empty, ErrorBox, DeviceStatusDot } from '@/components/ui';
import { getPatient } from '@/features/patients/api';
import { CARE_NOTE_FIELDS, hasCareNotes } from '@/features/patients/careNotes';
import { ResponsesPanel } from '@/features/patients/ResponsesPanel';
import { listEvents } from '@/features/care-events/activity';
import { listAlerts } from '@/features/alerts/api';
import { effectiveDeviceStatus } from '@/features/devices/api';
import { EventRow } from '@/features/care-events/EventRow';
import { AlertRow } from '@/features/alerts/AlertRow';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';
import { ActivityFormModal } from '@/features/care-events/ActivityForm';
import { CareActivitiesPanel } from '@/features/care-events/CareActivitiesPanel';
import { CareCalendar } from '@/features/calendar/CareCalendar';
import { HistoryView } from '@/features/history/HistoryView';
import { ageFrom, formatDateKey, timeAgo, todayIn } from '@/utils/dates';

type Tab = 'overview' | 'calendar' | 'activities' | 'responses' | 'history';

export default function PatientProfilePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab = requestedTab === 'messages' ? 'responses' : (['overview', 'calendar', 'activities', 'responses', 'history'].includes(requestedTab ?? '') ? requestedTab as Tab : 'overview');
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const { tz } = useCaregiver();
  const { profileMap, deviceByPatient } = useReferenceData();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const today = todayIn(tz);

  const patient = useData(() => getPatient(id), [id]);
  const todays = useData(() => listEvents({ from: today, to: today, patientId: id }), [id, today], ['care_events']);
  const alerts = useData(() => listAlerts({ patientId: id, unreviewedOnly: true }), [id], ['alerts']);

  if (patient.loading) return <Spinner />;
  if (patient.error) return <ErrorBox error={patient.error} />;
  const p = patient.data;
  if (!p) return <Empty>Patient not found. <Link to="/patients">Back to patients</Link></Empty>;

  const age = ageFrom(p.date_of_birth, p.age);
  const device = deviceByPatient.get(p.id);
  const ec = p.emergency_contact ?? {};

  return (
    <>
      <PageHeader
        title={<span className="row gap"><PatientAvatar patient={p} size={56} /> <span>{p.name} <Badge tone={p.status === 'ACTIVE' ? 'success' : 'muted'}>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></span></span>}
        subtitle={[age != null ? `${age} years` : null, device ? `P-kun: ${device.device_name}` : 'No P-kun assigned'].filter(Boolean).join(' · ')}
        actions={<>
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={p.status !== 'ACTIVE'}>+ New event</button>
          <Link className="btn" to={`/patients/${p.id}/edit`}>Edit patient</Link>
        </>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'calendar', label: 'Calendar' },
        { id: 'activities', label: 'Care activities' },
        { id: 'responses', label: 'Responses' },
        { id: 'history', label: 'History' },
      ]} />

      {tab === 'overview' && (
        <div className="grid-2">
          <Card title="Today's schedule" actions={<button className="link" onClick={() => setTab('calendar')}>Calendar →</button>}>
            {todays.loading ? <Spinner /> : !todays.data?.length ? <Empty>Nothing scheduled today.</Empty> : (
              <ul className="event-list">{todays.data.map((e) => <EventRow key={e.id} event={e} onOpen={setOpenId} showPatient={false} />)}</ul>
            )}
          </Card>
          <Card title={<>Alerts {alerts.data?.length ? <Badge tone="danger">{alerts.data.length}</Badge> : null}</>} actions={<button className="link" onClick={() => setTab('history')}>History →</button>}>
            {!alerts.data?.length ? <Empty>No open alerts.</Empty> : (
              <ul className="list">{alerts.data.map((a) => <AlertRow key={a.id} alert={a} onOpenEvent={setOpenId} />)}</ul>
            )}
          </Card>
          <Card title="Basic information">
            <dl className="details">
              <dt>Name</dt><dd>{p.name}</dd>
              <dt>Date of birth</dt><dd>{p.date_of_birth ? formatDateKey(p.date_of_birth, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</dd>
              <dt>Age</dt><dd>{age ?? '—'}</dd>
              <dt>Assigned caretaker</dt><dd>{p.assigned_caretaker_id ? profileMap.get(p.assigned_caretaker_id)?.full_name ?? '—' : '—'}</dd>
              <dt>Emergency contact</dt>
              <dd>{ec.name || ec.phone ? <>{ec.name}{ec.relationship ? ` (${ec.relationship})` : ''}{ec.phone ? <> · <a href={`tel:${ec.phone}`}>{ec.phone}</a></> : null}</> : '—'}</dd>
              <dt>P-kun device</dt>
              <dd>{device ? <span className="row gap-sm">{device.device_name} <DeviceStatusDot status={effectiveDeviceStatus(device)} /> <span className="muted small">last seen {timeAgo(device.last_seen)}</span></span> : <Link to="/devices">Assign a device</Link>}</dd>
            </dl>
          </Card>
          <Card title="🔒 Care notes" className="card-private" actions={<Link to={`/patients/${p.id}/edit`} className="link">Edit</Link>}>
            <p className="note">Caretaker-only. Never shown on P-kun.</p>
            {!hasCareNotes(p) ? <Empty>No care notes recorded.</Empty> : (
              <dl className="details">
                {CARE_NOTE_FIELDS.filter(([k]) => p[k]).map(([k, label]) => (
                  <div key={k} className="details-pair"><dt>{label}</dt><dd className="prewrap">{p[k]}</dd></div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      )}
      {tab === 'calendar' && <Card><CareCalendar patientId={p.id} /></Card>}
      {tab === 'activities' && <CareActivitiesPanel patientId={p.id} />}
      {tab === 'responses' && (
        <div className="stack">
          <ResponsesPanel patientId={p.id} />
          <Card title={`Daily check-ins for ${p.name}`}>
            <p>Review questions, answers, and guided follow-ups in the daily check-in view.</p>
            <Link className="btn btn-primary" to={`/check-ins?patient=${p.id}`}>Open daily check-in</Link>
          </Card>
        </div>
      )}
      {tab === 'history' && <HistoryView patientId={p.id} />}

      {openId && <EventDetailsModal eventId={openId} onClose={() => setOpenId(null)} />}
      {creating && <ActivityFormModal mode={{ kind: 'create', lockPatient: true, initial: { patient_id: p.id } }} onClose={() => setCreating(false)} />}
    </>
  );
}

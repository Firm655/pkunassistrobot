import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Card, PageHeader, Empty, Spinner, Stat, PatientAvatar, DeviceStatusDot, ErrorBox, Badge } from '@/components/ui';
import { listEvents } from '@/features/care-events/activity';
import { listAlerts } from '@/features/alerts/api';
import { listMessages } from '@/features/messages/api';
import { effectiveDeviceStatus } from '@/features/devices/api';
import { EventRow } from '@/features/care-events/EventRow';
import { AlertRow } from '@/features/alerts/AlertRow';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';
import { ActivityFormModal } from '@/features/care-events/ActivityForm';
import { addDays, formatDateKey, timeAgo, todayIn } from '@/utils/dates';
import type { CareEvent } from '@/types/db';

export default function DashboardPage() {
  const { tz, profile } = useCaregiver();
  const { patients, devices, deviceByPatient, patientMap } = useReferenceData();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const today = todayIn(tz);

  const events = useData(() => listEvents({ from: addDays(today, -1), to: today, includeSkipped: false }), [today], ['care_events']);
  const alerts = useData(() => listAlerts({ unreviewedOnly: true, limit: 50 }), [], ['alerts']);
  const requests = useData(() => listMessages({ patientRequestsOnly: true, limit: 5 }), [], ['messages']);

  const all = events.data ?? [];
  const todays = all.filter((e) => e.scheduled_date === today);
  const upcoming = todays.filter((e) => e.status === 'SCHEDULED' || e.status === 'PENDING');
  const completed = all.filter((e) => e.status === 'COMPLETED' || e.status === 'ALERT')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 8);
  const missed = all.filter((e) => e.status === 'MISSED').reverse();
  const onlineCount = devices.filter((d) => effectiveDeviceStatus(d) === 'ONLINE').length;
  const activePatients = patients.filter((p) => p.status === 'ACTIVE');

  const perPatient = (id: string) => {
    const t = todays.filter((e) => e.patient_id === id);
    return { done: t.filter((e: CareEvent) => ['COMPLETED', 'ALERT'].includes(e.status)).length, total: t.length, missed: t.filter((e) => e.status === 'MISSED').length };
  };
  const alertCount = (id: string) => (alerts.data ?? []).filter((a) => a.patient_id === id).length;

  return (
    <>
      <PageHeader
        title={`Good ${greeting(tz)}, ${profile.full_name.split(' ')[0]}`}
        subtitle={formatDateKey(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add schedule event</button>
            <Link className="btn" to="/calendar">View calendar</Link>
            <Link className="btn" to="/patients">View patients</Link>
            <Link className="btn" to="/alerts">View alerts</Link>
          </>
        }
      />
      <ErrorBox error={events.error || alerts.error} />

      <div className="stats">
        <Stat label="Upcoming today" value={upcoming.length} tone="info" onClick={() => navigate('/calendar')} />
        <Stat label="Completed today" value={todays.filter((e) => e.status === 'COMPLETED').length} tone="success" />
        <Stat label="Missed today" value={todays.filter((e) => e.status === 'MISSED').length} tone={missed.length ? 'warning' : 'neutral'} />
        <Stat label="Active alerts" value={alerts.data?.length ?? '–'} tone={(alerts.data?.length ?? 0) > 0 ? 'danger' : 'neutral'} onClick={() => navigate('/alerts')} />
        <Stat label="P-kun online" value={`${onlineCount}/${devices.length}`} tone={devices.length && onlineCount < devices.length ? 'warning' : 'success'} onClick={() => navigate('/devices')} />
      </div>

      <div className="grid-2">
        <Card title="Today's upcoming events" actions={<Link to="/calendar" className="link">Calendar →</Link>}>
          {events.loading ? <Spinner /> : upcoming.length === 0 ? <Empty>No more events scheduled today.</Empty> : (
            <ul className="event-list">{upcoming.map((e) => <EventRow key={e.id} event={e} onOpen={setOpenId} />)}</ul>
          )}
        </Card>
        <Card title={<>Active alerts {alerts.data?.length ? <Badge tone="danger">{alerts.data.length}</Badge> : null}</>} actions={<Link to="/alerts" className="link">All alerts →</Link>}>
          {alerts.loading ? <Spinner /> : !alerts.data?.length ? <Empty>No alerts need review. 🎉</Empty> : (
            <ul className="list">{alerts.data.slice(0, 6).map((a) => <AlertRow key={a.id} alert={a} compact />)}</ul>
          )}
        </Card>
        <Card title="Recently completed">
          {events.loading ? <Spinner /> : completed.length === 0 ? <Empty>No responses yet today.</Empty> : (
            <ul className="event-list">{completed.map((e) => <EventRow key={e.id} event={e} onOpen={setOpenId} showDate={e.scheduled_date !== today} />)}</ul>
          )}
        </Card>
        <Card title="Missed events" actions={<span className="muted small">Today &amp; yesterday</span>}>
          {events.loading ? <Spinner /> : missed.length === 0 ? <Empty>Nothing missed.</Empty> : (
            <ul className="event-list">{missed.map((e) => <EventRow key={e.id} event={e} onOpen={setOpenId} showDate />)}</ul>
          )}
        </Card>
        <Card title="Patient overview" actions={<Link to="/patients" className="link">All patients →</Link>} pad={false}>
          {activePatients.length === 0 ? <div className="card-body"><Empty>No patients yet. <Link to="/patients/new">Add a patient</Link></Empty></div> : (
            <table className="table">
              <thead><tr><th>Patient</th><th>Today</th><th>Alerts</th><th>P-kun</th></tr></thead>
              <tbody>
                {activePatients.map((p) => {
                  const s = perPatient(p.id);
                  const dev = deviceByPatient.get(p.id);
                  return (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                      <td><span className="row gap-sm"><PatientAvatar patient={p} size={28} /> {p.name}</span></td>
                      <td>
                        <div className="progress" title={`${s.done} of ${s.total} done`}><span style={{ width: s.total ? `${(100 * s.done) / s.total}%` : 0 }} /></div>
                        <span className="small muted">{s.done}/{s.total}{s.missed ? ` · ${s.missed} missed` : ''}</span>
                      </td>
                      <td>{alertCount(p.id) ? <Badge tone="danger">{alertCount(p.id)}</Badge> : <span className="muted">—</span>}</td>
                      <td>{dev ? <DeviceStatusDot status={effectiveDeviceStatus(dev)} /> : <span className="muted small">None</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="P-kun devices" actions={<Link to="/devices" className="link">Manage →</Link>}>
          {devices.length === 0 ? <Empty>No devices paired yet.</Empty> : (
            <ul className="list">
              {devices.map((d) => (
                <li key={d.id} className="list-item">
                  <span aria-hidden>🤖</span>
                  <div className="grow">
                    <strong>{d.device_name}</strong>
                    <div className="muted small">{d.assigned_patient_id ? patientMap.get(d.assigned_patient_id)?.name : 'Unassigned'} · last seen {timeAgo(d.last_seen)}</div>
                  </div>
                  <DeviceStatusDot status={effectiveDeviceStatus(d)} />
                </li>
              ))}
            </ul>
          )}
          {!!requests.data?.length && (
            <>
              <h3 className="section-title">Latest patient requests</h3>
              <ul className="list">
                {requests.data.map((m) => (
                  <li key={m.id} className="list-item">
                    <span aria-hidden>{m.request_code === 'HELP' ? '🆘' : m.request_code === 'NOT_RIGHT' ? '⚠️' : '🍙'}</span>
                    <div className="grow"><strong>{m.message}</strong><div className="muted small">{patientMap.get(m.patient_id)?.name} · {timeAgo(m.created_at)}</div></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {openId && <EventDetailsModal eventId={openId} onClose={() => setOpenId(null)} />}
      {creating && <ActivityFormModal mode={{ kind: 'create' }} onClose={() => setCreating(false)} />}
    </>
  );
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

import { useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Card, Tabs, Spinner, Empty, ErrorBox, EventTypeTag, StatusBadge, Badge } from '@/components/ui';
import { EVENT_STATUSES, EVENT_TYPES, EVENT_TYPE_META, STATUS_META } from '@/lib/constants';
import { addDays, formatDateKey, formatDateTime, hhmm, todayIn, zonedStartOfDay } from '@/utils/dates';
import { eventTitle, responseSummary, titleCase } from '@/utils/format';
import { listEvents } from '@/features/care-events/activity';
import { listMessages } from '@/features/messages/api';
import { listAlerts } from '@/features/alerts/api';
import { listInteractionLogs } from './api';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';
import { AlertRow } from '@/features/alerts/AlertRow';
import type { EventStatus, EventType } from '@/types/db';

type Tab = 'events' | 'messages' | 'alerts' | 'log';

const ACTION_LABEL: Record<string, string> = {
  PATIENT_RESPONSE: 'Patient responded',
  PATIENT_REQUEST: 'Patient request',
  CAREGIVER_MESSAGE: 'Caretaker message sent',
  MESSAGE_ACKNOWLEDGED: 'Message acknowledged',
  ALERT_REVIEWED: 'Alert reviewed',
  EVENT_MISSED: 'Event missed',
  DEVICE_PAIRED: 'P-kun paired',
};

export function HistoryView({ patientId: fixedPatient }: { patientId?: string }) {
  const { tz } = useCaregiver();
  const { patients, patientMap, devices } = useReferenceData();
  const today = todayIn(tz);
  const [tab, setTab] = useState<Tab>('events');
  const [patient, setPatient] = useState('');
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(today);
  const [type, setType] = useState<EventType | ''>('');
  const [status, setStatus] = useState<EventStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const pid = fixedPatient ?? (patient || undefined);
  const fromIso = zonedStartOfDay(from, tz);
  const toIso = zonedStartOfDay(addDays(to, 1), tz);
  const deviceName = (id: string | null) => devices.find((d) => d.id === id)?.device_name;

  const events = useData(
    () => (tab === 'events' ? listEvents({ from, to, patientId: pid, types: type ? [type] : [], statuses: status ? [status] : [], includeSkipped: true }) : Promise.resolve([])),
    [tab, from, to, pid, type, status], ['care_events'],
  );
  const messages = useData(
    () => (tab === 'messages' ? listMessages({ patientId: pid, since: fromIso, limit: 500, patientResponsesOnly: true }) : Promise.resolve([])),
    [tab, pid, fromIso], ['messages'],
  );
  const alerts = useData(
    () => (tab === 'alerts' ? listAlerts({ patientId: pid, since: fromIso, limit: 500 }) : Promise.resolve([])),
    [tab, pid, fromIso], ['alerts'],
  );
  const logs = useData(
    () => (tab === 'log' ? listInteractionLogs({ patientId: pid, from: fromIso, to: toIso, limit: 500 }) : Promise.resolve([])),
    [tab, pid, fromIso, toIso], ['interaction_logs'],
  );
  const inRange = <T,>(rows: T[] | undefined, key: (r: T) => string) => (rows ?? []).filter((r) => key(r) < toIso);
  const current = { events, messages, alerts, log: logs }[tab];

  return (
    <>
      <div className="filters">
        {!fixedPatient && (
          <select value={patient} onChange={(e) => setPatient(e.target.value)} aria-label="Patient">
            <option value="">All patients</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <label className="inline-field">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline-field">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {tab === 'events' && (
          <>
            <select value={type} onChange={(e) => setType(e.target.value as EventType | '')} aria-label="Event type">
              <option value="">All event types</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].label}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as EventStatus | '')} aria-label="Status">
              <option value="">All statuses</option>
              {EVENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </>
        )}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'events', label: 'Care events & responses' },
        { id: 'messages', label: 'Patient requests' },
        { id: 'alerts', label: 'Alerts' },
        { id: 'log', label: 'Activity log' },
      ]} />
      <ErrorBox error={current.error} />
      <Card pad={false}>
        {current.loading ? <div className="card-body"><Spinner /></div> : (
          <div className="table-scroll">
            {tab === 'events' && (
              !events.data?.length ? <div className="card-body"><Empty>No events in this range.</Empty></div> : (
                <table className="table">
                  <thead><tr><th>Scheduled</th>{!fixedPatient && <th>Patient</th>}<th>Type</th><th>Activity</th><th>Status</th><th>Response</th><th>Responded</th></tr></thead>
                  <tbody>
                    {[...events.data].reverse().map((e) => (
                      <tr key={e.id} className="clickable" onClick={() => setOpenId(e.id)}>
                        <td className="nowrap">{formatDateKey(e.scheduled_date)} {hhmm(e.scheduled_time)}</td>
                        {!fixedPatient && <td>{patientMap.get(e.patient_id)?.name}</td>}
                        <td><EventTypeTag type={e.event_type} short /></td>
                        <td>{eventTitle(e)}</td>
                        <td><StatusBadge status={e.status} /></td>
                        <td>{responseSummary(e) ?? <span className="muted">—</span>}</td>
                        <td className="nowrap small">{e.completed_at ? formatDateTime(e.completed_at, tz) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {tab === 'messages' && (() => {
              const rows = inRange(messages.data, (m) => m.created_at);
              return !rows.length ? <div className="card-body"><Empty>No patient requests in this range.</Empty></div> : (
                <table className="table">
                  <thead><tr><th>Time</th>{!fixedPatient && <th>Patient</th>}<th>Type</th><th>Response</th></tr></thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap small">{formatDateTime(m.created_at, tz)}</td>
                        {!fixedPatient && <td>{patientMap.get(m.patient_id)?.name}</td>}
                        <td>{m.message_type === 'PATIENT_REQUEST' ? <Badge tone={m.request_code === 'HUNGRY' ? 'info' : 'danger'}>Patient request</Badge> : <Badge tone="success">Patient response</Badge>}</td>
                        <td>{m.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            {tab === 'alerts' && (() => {
              const rows = inRange(alerts.data, (a) => a.created_at);
              return !rows.length ? <div className="card-body"><Empty>No alerts in this range.</Empty></div> : (
                <ul className="list card-body">{rows.map((a) => <AlertRow key={a.id} alert={a} onOpenEvent={setOpenId} />)}</ul>
              );
            })()}
            {tab === 'log' && (
              !logs.data?.length ? <div className="card-body"><Empty>No activity in this range.</Empty></div> : (
                <table className="table">
                  <thead><tr><th>Time</th>{!fixedPatient && <th>Patient</th>}<th>Action</th><th>Details</th></tr></thead>
                  <tbody>
                    {logs.data.map((l) => (
                      <tr key={l.id} className={l.event_id ? 'clickable' : ''} onClick={() => l.event_id && setOpenId(l.event_id)}>
                        <td className="nowrap small">{formatDateTime(l.created_at, tz)}</td>
                        {!fixedPatient && <td>{l.patient_id ? patientMap.get(l.patient_id)?.name : '—'}</td>}
                        <td>{ACTION_LABEL[l.action] ?? titleCase(l.action)}</td>
                        <td className="small muted">
                          {typeof l.data?.response === 'string' && <>Answer: <strong>{l.data.response}</strong> </>}
                          {typeof l.data?.request_code === 'string' && <>Request: <strong>{titleCase(l.data.request_code)}</strong> </>}
                          {l.device_id && <>via {deviceName(l.device_id) ?? 'P-kun'}</>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        )}
      </Card>
      {openId && <EventDetailsModal eventId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}


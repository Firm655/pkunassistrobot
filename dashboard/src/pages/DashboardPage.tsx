import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus, Search, Users } from 'lucide-react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Spinner, PatientAvatar, DeviceStatusDot, ErrorBox, StatusBadge, EventTypeTag } from '@/components/ui';
import { listEvents } from '@/features/care-events/activity';
import { listAlerts } from '@/features/alerts/api';
import { listMessages } from '@/features/messages/api';
import { effectiveDeviceStatus } from '@/features/devices/api';
import { AlertRow } from '@/features/alerts/AlertRow';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';
import { ActivityFormModal } from '@/features/care-events/ActivityForm';
import { addDays, ageFrom, formatDateKey, hhmm, timeAgo, todayIn } from '@/utils/dates';
import { eventTitle, responseSummary } from '@/utils/format';

type ActivityFilter = 'all' | 'upcoming' | 'missed' | 'completed';
const filterNames: Record<ActivityFilter, string> = { all: 'All activity', upcoming: 'Upcoming', missed: 'Missed', completed: 'Completed' };

export default function DashboardPage() {
  const { tz } = useCaregiver();
  const { patients, devices, deviceByPatient, patientMap, loading, error: referenceError } = useReferenceData();
  const today = todayIn(tz);
  const [day, setDay] = useState(today);
  const [patientId, setPatientId] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const events = useData(() => listEvents({ from: day, to: day, includeSkipped: false }), [day], ['care_events']);
  const alerts = useData(() => listAlerts({ unreviewedOnly: true, patientId: patientId || undefined, limit: 300 }), [patientId], ['alerts']);
  const requests = useData(() => listMessages({ patientRequestsOnly: true, patientId: patientId || undefined, limit: 5 }), [patientId], ['messages']);
  const active = patients.filter((p) => p.status === 'ACTIVE');
  const visible = active.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const patient = patientMap.get(patientId);
  const scoped = (events.data ?? []).filter((e) => e.scheduled_date === day && (!patientId || e.patient_id === patientId));
  const activity = {
    all: scoped,
    upcoming: scoped.filter((e) => ['SCHEDULED', 'PENDING'].includes(e.status)),
    missed: scoped.filter((e) => e.status === 'MISSED'),
    completed: scoped.filter((e) => ['COMPLETED', 'ALERT'].includes(e.status)),
  };
  const rows = [...activity[filter]].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  const priority = { HIGH: 0, ATTENTION: 1, NORMAL: 2 };
  const followups = [...(alerts.data ?? [])].sort((a, b) => priority[a.priority] - priority[b.priority]);
  const shownDevices = devices.filter((d) => !patientId || d.assigned_patient_id === patientId);
  const age = patient ? ageFrom(patient.date_of_birth, patient.age) : null;
  const complete = activity.completed.length;

  return <div className="day-workspace">
    <aside className="patient-roster" aria-label="Patient selection">
      <div className="roster-heading"><h2>Patients <span>{active.length}</span></h2><Link to="/patients/new" className="icon-btn" title="Add patient" aria-label="Add patient"><Plus size={18} /></Link></div>
      <label className="roster-search"><Search size={16} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a patient" aria-label="Find a patient" /></label>
      <button className={`roster-all ${!patientId ? 'selected' : ''}`} aria-pressed={!patientId} onClick={() => setPatientId('')}><Users size={18} /><span>All patients</span><span>{active.length}</span></button>
      <div className="roster-label">Active patients</div>
      {loading ? <Spinner /> : referenceError ? <ErrorBox error={referenceError} /> : <ul className="roster-list">{visible.map((p) => {
        const device = deviceByPatient.get(p.id);
        const status = device ? effectiveDeviceStatus(device) : null;
        return <li key={p.id}><button className={`roster-patient ${patientId === p.id ? 'selected' : ''}`} aria-pressed={patientId === p.id} onClick={() => setPatientId(p.id)}><PatientAvatar patient={p} size={38} /><span><strong>{p.name}</strong><small><span className={`roster-dot ${status === 'ONLINE' ? 'online' : ''}`} />{status === 'ONLINE' ? 'Device online' : status === 'PAIRING' ? 'Pairing device' : device ? 'Device offline' : 'No device assigned'}</small></span><ChevronRight size={14} /></button></li>;
      })}</ul>}
      {!loading && !referenceError && !visible.length && <p className="roster-empty">{search ? 'No patients match this name.' : 'No active patients yet.'}</p>}
      <Link to="/patients" className="roster-directory">Patient directory <ArrowUpRight size={15} /></Link>
    </aside>

    <div className="day-main">
      <header className="day-heading"><div><div className="day-eyebrow">Daily care</div><h1>{patient?.name ?? 'My day'}</h1><p>{patient ? `${age == null ? 'Patient' : `${age} years old`} · ${formatDateKey(day, {day:'numeric', month:'long'})}` : formatDateKey(day, {weekday:'long', day:'numeric', month:'long', year:'numeric'})}</p></div><div className="day-actions">{patient && <Link className="btn" to={`/patients/${patient.id}`}>Patient profile <ArrowUpRight size={15} /></Link>}<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={17} /> Schedule care</button></div></header>
      <div className="day-toolbar"><div className="day-navigation"><button className="icon-btn" aria-label="Previous day" title="Previous day" onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={18} /></button><button className="btn btn-sm" onClick={() => setDay(today)}>Today</button><button className="icon-btn" aria-label="Next day" title="Next day" onClick={() => setDay(addDays(day, 1))}><ChevronRight size={18} /></button><label className="day-picker"><CalendarDays size={16} /><input type="date" aria-label="Care date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label></div><Link to="/calendar" className="calendar-link">Open calendar <ArrowUpRight size={15} /></Link></div>
      <ErrorBox error={events.error || alerts.error || requests.error} />

      <div className="day-body">
        <section className="agenda" aria-labelledby="agenda-heading">
          <div className="agenda-heading"><h2 id="agenda-heading">Daily agenda</h2><span>{events.loading || events.error ? 'Loading status' : `${complete} of ${scoped.length} completed`}</span></div>
          <div className="agenda-filters" aria-label="Activity filter">{(Object.keys(filterNames) as ActivityFilter[]).map((key) => <button aria-pressed={filter === key} className={filter === key ? 'selected' : ''} key={key} onClick={() => setFilter(key)}>{filterNames[key]} <span>{events.loading || events.error ? '—' : activity[key].length}</span></button>)}</div>
          {events.loading ? <Spinner /> : events.error ? <div className="agenda-empty"><h3>Schedule unavailable</h3><button className="btn" onClick={events.reload}>Try again</button></div> : rows.length ? <ol className="agenda-list">{rows.map((e) => <li key={e.id}>
            <time className="agenda-time">{hhmm(e.scheduled_time)}<span>{e.status === 'COMPLETED' ? <Check size={14} /> : <Clock3 size={14} />}</span></time>
            <button className={`agenda-event ${e.status === 'MISSED' ? 'is-missed' : ''}`} onClick={() => setOpenId(e.id)}><span className="agenda-event-top"><EventTypeTag type={e.event_type} short /><StatusBadge status={e.status} /></span><strong>{eventTitle(e)}</strong><span className="agenda-person"><PatientAvatar patient={patientMap.get(e.patient_id)} size={22} />{patientMap.get(e.patient_id)?.name ?? 'Patient'}{responseSummary(e) && <span className="agenda-response">{responseSummary(e)}</span>}</span><ChevronRight className="agenda-arrow" size={17} /></button>
          </li>)}</ol> : <div className="agenda-empty"><CalendarDays size={28} strokeWidth={1.4} /><h3>{filter === 'all' ? 'A clear schedule' : `No ${filter} activities`}</h3><p>{filter === 'all' ? 'There is no care scheduled for this date.' : 'No activities match this view.'}</p><button className="btn" onClick={() => setCreating(true)}><Plus size={16} /> Schedule care</button></div>}
          <div className="agenda-end"><span /><p>{rows.length ? 'End of schedule' : formatDateKey(day, {weekday:'long', day:'numeric', month:'short'})}</p><span /></div>
        </section>

        <aside className="day-followups" aria-label="Follow-ups and devices">
          <section className="followup-section"><header><h2>Needs attention</h2><Link to="/alerts">View all <ArrowUpRight size={14} /></Link></header><p className="followup-caption">Open alerts · all dates{followups.length >= 300 ? ' · latest 300' : ''}</p>
            {alerts.loading ? <Spinner /> : alerts.error ? <p className="muted">Alerts unavailable.</p> : followups.length ? <ul className="list followup-list">{followups.slice(0, 5).map((a) => <AlertRow key={a.id} alert={a} onOpenEvent={setOpenId} onReviewed={alerts.reload} />)}</ul> : <p className="followup-clear"><Check size={16} /> No alerts awaiting review</p>}
          </section>
          <section className="followup-section"><header><h2>Patient requests</h2><Link to="/check-ins">View all <ArrowUpRight size={14} /></Link></header>{requests.loading ? <Spinner /> : requests.error ? <p className="muted">Requests unavailable.</p> : requests.data?.length ? <ul className="list">{requests.data.map((m) => <li className="day-request" key={m.id}><Link to={`/patients/${m.patient_id}`}>{patientMap.get(m.patient_id)?.name ?? 'Patient'}</Link><p>{m.message}</p><small>{timeAgo(m.created_at)}</small></li>)}</ul> : <p className="followup-clear">No recent requests</p>}</section>
          <section className="followup-section device-section"><header><h2><Bot size={17} /> Device connection</h2><Link to="/devices">Manage <ArrowUpRight size={14} /></Link></header>{referenceError ? <p className="muted">Devices unavailable.</p> : loading ? <Spinner /> : shownDevices.length ? <ul className="list">{shownDevices.map((d) => <li className="day-device" key={d.id}><div><strong>{d.device_name}</strong><small>Last seen {timeAgo(d.last_seen)}</small></div><DeviceStatusDot status={effectiveDeviceStatus(d)} /></li>)}</ul> : <p className="followup-clear">No device assigned</p>}</section>
        </aside>
      </div>
    </div>
    {openId && <EventDetailsModal eventId={openId} onClose={() => setOpenId(null)} />}
    {creating && <ActivityFormModal mode={{ kind:'create', initial: { date:day, patient_id:patientId } }} onClose={() => setCreating(false)} />}
  </div>;
}

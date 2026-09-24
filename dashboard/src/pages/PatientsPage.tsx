import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { PageHeader, Card, PatientAvatar, Badge, DeviceStatusDot, Empty, Spinner, ErrorBox } from '@/components/ui';
import { listEvents } from '@/features/care-events/activity';
import { listAlerts } from '@/features/alerts/api';
import { effectiveDeviceStatus } from '@/features/devices/api';
import { ageFrom, todayIn } from '@/utils/dates';

export default function PatientsPage() {
  const { tz } = useCaregiver();
  const { patients, deviceByPatient, profileMap, loading } = useReferenceData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | ''>('ACTIVE');
  const today = todayIn(tz);

  const events = useData(() => listEvents({ from: today, to: today }), [today], ['care_events']);
  const alerts = useData(() => listAlerts({ unreviewedOnly: true, limit: 500 }), [], ['alerts']);

  const rows = useMemo(() => patients
    .filter((p) => !status || p.status === status)
    .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [patients, q, status]);

  const summary = (id: string) => {
    const t = (events.data ?? []).filter((e) => e.patient_id === id);
    return {
      total: t.length,
      done: t.filter((e) => e.status === 'COMPLETED' || e.status === 'ALERT').length,
      upcoming: t.filter((e) => e.status === 'SCHEDULED' || e.status === 'PENDING').length,
      missed: t.filter((e) => e.status === 'MISSED').length,
    };
  };
  const alertsFor = (id: string) => (alerts.data ?? []).filter((a) => a.patient_id === id);

  return (
    <>
      <PageHeader title="Patients" subtitle={`${patients.filter((p) => p.status === 'ACTIVE').length} active`}
        actions={<Link to="/patients/new" className="btn btn-primary">+ Add patient</Link>} />
      <div className="filters">
        <input className="search" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="">All</option>
        </select>
      </div>
      <ErrorBox error={events.error || alerts.error} />
      <Card pad={false}>
        {loading ? <div className="card-body"><Spinner /></div> : rows.length === 0 ? (
          <div className="card-body"><Empty>{patients.length === 0 ? <>No patients yet. <Link to="/patients/new">Add the first patient</Link>.</> : 'No patients match.'}</Empty></div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Patient</th><th>Status</th><th>Today's schedule</th><th>Alerts</th><th>Assigned P-kun</th><th>Caretaker</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const s = summary(p.id);
                  const al = alertsFor(p.id);
                  const dev = deviceByPatient.get(p.id);
                  const age = ageFrom(p.date_of_birth, p.age);
                  return (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                      <td>
                        <span className="row gap-sm">
                          <PatientAvatar patient={p} size={40} />
                          <span><strong>{p.name}</strong>{age != null && <div className="muted small">{age} years</div>}</span>
                        </span>
                      </td>
                      <td><Badge tone={p.status === 'ACTIVE' ? 'success' : 'muted'}>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></td>
                      <td>
                        {s.total === 0 ? <span className="muted small">Nothing scheduled</span> : (
                          <span className="small">
                            <strong>{s.done}</strong>/{s.total} done · {s.upcoming} upcoming
                            {s.missed > 0 && <> · <span className="text-warning">{s.missed} missed</span></>}
                          </span>
                        )}
                      </td>
                      <td>{al.length ? <Badge tone={al.some((a) => a.priority === 'HIGH') ? 'danger' : 'warning'}>{al.length} open</Badge> : <span className="muted">—</span>}</td>
                      <td>{dev ? <span className="row gap-sm small">{dev.device_name} <DeviceStatusDot status={effectiveDeviceStatus(dev)} /></span> : <span className="muted small">None</span>}</td>
                      <td className="small">{p.assigned_caretaker_id ? profileMap.get(p.assigned_caretaker_id)?.full_name ?? '—' : '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row gap-sm nowrap">
                          <Link className="btn btn-sm" to={`/patients/${p.id}`}>Profile</Link>
                          <Link className="btn btn-sm btn-ghost" to={`/patients/${p.id}?tab=calendar`}>Calendar</Link>
                          <Link className="btn btn-sm btn-ghost" to={`/patients/${p.id}?tab=history`}>History</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

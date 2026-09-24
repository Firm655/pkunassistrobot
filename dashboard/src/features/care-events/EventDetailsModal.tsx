import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal, StatusBadge, EventTypeTag, PriorityBadge, ErrorBox, Spinner, Badge } from '@/components/ui';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useToast } from '@/contexts/ToastContext';
import { useData } from '@/hooks/useData';
import { supabase, unwrap } from '@/lib/supabase';
import { ALERT_TYPE_LABEL } from '@/lib/constants';
import { eventTitle, responseSummary, titleCase } from '@/utils/format';
import { formatDateKey, formatDateTime, hhmm } from '@/utils/dates';
import type { Alert, CareEvent, PatientResponse } from '@/types/db';
import { getEvent, getSchedule, skipEvent } from './activity';
import { ActivityFormModal, type ActivityFormMode } from './ActivityForm';
import { reviewAlert } from '@/features/alerts/api';

const EDITABLE = ['SCHEDULED', 'PENDING'];

export function EventDetailsModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { tz } = useCaregiver();
  const { patientMap } = useReferenceData();
  const toast = useToast();
  const [formMode, setFormMode] = useState<ActivityFormMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error: loadError } = useData(async () => {
    const event = await getEvent(eventId);
    if (!event) return null;
    const [alerts, responses] = await Promise.all([
      supabase.from('alerts').select('*').eq('event_id', eventId).order('created_at'),
      supabase.from('patient_responses').select('*').eq('event_id', eventId),
    ]);
    return {
      event,
      alerts: unwrap(alerts) as Alert[],
      response: (unwrap(responses) as PatientResponse[])[0] ?? null,
    };
  }, [eventId], ['care_events', 'alerts', 'patient_responses']);

  if (formMode) return <ActivityFormModal mode={formMode} onClose={() => setFormMode(null)} onSaved={onClose} />;

  const e = data?.event;
  const patient = e ? patientMap.get(e.patient_id) : undefined;

  const skip = async () => {
    if (!e || !confirm('Skip this event? It will not be shown on P-kun.')) return;
    setBusy(true);
    try { await skipEvent(e.id); toast({ kind: 'success', title: 'Event skipped' }); onClose(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const editSeries = async () => {
    if (!e?.source_table || !e.source_id) return;
    setBusy(true);
    try { setFormMode({ kind: 'edit-schedule', table: e.source_table, schedule: await getSchedule(e.source_table, e.source_id) }); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const review = async (id: string) => {
    try { await reviewAlert(id); } catch (err) { setError((err as Error).message); }
  };

  return (
    <Modal
      title={e ? <span className="row gap-sm"><EventTypeTag type={e.event_type} short /> {eventTitle(e)}</span> : 'Event'}
      onClose={onClose}
      wide
      footer={e && (
        <>
          {patient && <Link className="btn btn-ghost" to={`/patients/${patient.id}`} onClick={onClose}>Open patient</Link>}
          <div className="spacer" />
          {EDITABLE.includes(e.status) && <button className="btn btn-danger-ghost" onClick={skip} disabled={busy}>Skip</button>}
          {e.source_table && <button className="btn" onClick={editSeries} disabled={busy}>Edit series</button>}
          {EDITABLE.includes(e.status) && (
            <button className="btn btn-primary" onClick={() => setFormMode({ kind: 'edit-event', event: e })} disabled={busy}>
              {e.source_table ? 'Edit this occurrence' : 'Edit'}
            </button>
          )}
        </>
      )}
    >
      {loading && <Spinner />}
      <ErrorBox error={loadError || error} />
      {data === null && <p>This event no longer exists.</p>}
      {e && (
        <>
          <dl className="details">
            <dt>Patient</dt><dd>{patient?.name ?? '—'}</dd>
            <dt>Scheduled</dt><dd>{formatDateKey(e.scheduled_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at {hhmm(e.scheduled_time)}</dd>
            <dt>Status</dt><dd><StatusBadge status={e.status} /></dd>
            <dt>Recurrence</dt><dd>{e.source_table ? `${titleCase(e.recurrence)} (part of a recurring schedule)` : 'One-off'}</dd>
            <dt>Response due by</dt><dd>{formatDateTime(e.due_at, tz)}</dd>
            {e.description && (<><dt>Description</dt><dd>{e.description}</dd></>)}
            <EventPayload event={e} />
          </dl>

          <h3 className="section-title">Patient response</h3>
          {!e.response_data?.response ? (
            <p className="muted">
              {e.status === 'MISSED' ? 'No response was received before the deadline.'
                : e.status === 'SKIPPED' ? 'This event was skipped.'
                  : e.event_type === 'TASK' ? 'Not yet displayed on P-kun.' : 'Waiting for the patient.'}
            </p>
          ) : (
            <dl className="details">
              <dt>Answer</dt>
              <dd><strong>{responseSummary(e)}</strong> {e.status === 'ALERT' && <Badge tone="danger">Generated alert</Badge>}</dd>
              <dt>Responded at</dt><dd>{formatDateTime(data.response?.response_time ?? e.completed_at, tz)}</dd>
              {data.response && (<><dt>Received by server</dt><dd>{formatDateTime(data.response.received_at, tz)}</dd></>)}
            </dl>
          )}

          {data.alerts.length > 0 && (
            <>
              <h3 className="section-title">Alerts</h3>
              <ul className="list">
                {data.alerts.map((a) => (
                  <li key={a.id} className="list-item">
                    <PriorityBadge priority={a.priority} />
                    <div className="grow">
                      <strong>{ALERT_TYPE_LABEL[a.alert_type]}</strong>
                      <div className="muted small">{a.message} · {formatDateTime(a.created_at, tz)}</div>
                    </div>
                    {a.reviewed ? <Badge tone="success">Reviewed</Badge>
                      : <button className="btn btn-sm" onClick={() => review(a.id)}>Mark reviewed</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function EventPayload({ event: e }: { event: CareEvent }) {
  const p = e.payload as Record<string, unknown>;
  switch (e.event_type) {
    case 'MEDICINE':
      return (<><dt>Medicine</dt><dd>{String(p.name ?? e.title)} — {String(p.dosage ?? '')}</dd>
        {p.instructions ? (<><dt>Instructions</dt><dd>{String(p.instructions)}</dd></>) : null}</>);
    case 'DAILY_CHECK_IN': {
      const answers = (p.answers as string[]) ?? [];
      const concerning = (p.concerning_answers as string[]) ?? [];
      return (<><dt>Answers</dt><dd className="row wrap gap-sm">{answers.map((a) => (
        <Badge key={a} tone={concerning.includes(a) ? 'warning' : 'neutral'} title={concerning.includes(a) ? 'Concerning answer' : undefined}>{a}{concerning.includes(a) ? ' ⚠' : ''}</Badge>
      ))}</dd></>);
    }
    case 'MEAL':
      return (<><dt>Meal</dt><dd>{titleCase(String(p.meal_type ?? e.title))}</dd></>);
    default:
      return null;
  }
}

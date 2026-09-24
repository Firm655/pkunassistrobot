import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, PatientAvatar, Spinner } from '@/components/ui';
import { addDays, formatDateKey, formatDateTime, todayIn, zonedStartOfDay } from '@/utils/dates';
import { getDailyCheckIns, sendFollowUp, type DailyCheckIns } from '@/features/check-ins/api';
import type { CareEvent, PatientResponse } from '@/types/db';

const templates = [
  { label: 'Sleep', question: 'What disturbed your sleep?', answers: ['Could not fall asleep', 'Woke up often', 'Woke up early', 'Not sure'] },
  { label: 'Eating', question: "Why haven't you eaten?", answers: ['Not hungry', 'Food not ready', 'Need help', 'Not sure'] },
  { label: 'Company', question: 'Would you like someone to contact you?', answers: ['Yes, please', 'Later', 'No, thank you'] },
  { label: 'Help', question: 'What would you like help with?', answers: ['Moving around', 'Food or drink', 'Contact caregiver', 'Not sure'] },
];
const answerOf = (e: CareEvent, d: DailyCheckIns) => d.responses.find((r) => r.event_id === e.id);
const overdue = (e: CareEvent) => !e.completed_at && (e.status === 'MISSED' || new Date(e.due_at).getTime() < Date.now());
const concerning = (e: CareEvent, d: DailyCheckIns) => Boolean(answerOf(e, d) &&
  ((e.payload.concerning_answers as string[] | undefined) ?? []).includes(answerOf(e, d)!.response));
const needsReview = (e: CareEvent, d: DailyCheckIns) => d.alerts.some((a) => a.event_id === e.id && !a.reviewed);

export default function CheckInsPage() {
  const { tz } = useCaregiver();
  const { patients, deviceByPatient } = useReferenceData();
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : todayIn(tz);
  const selected = params.get('patient') ?? '';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [followUp, setFollowUp] = useState<CareEvent | null>(null);
  const query = useData(() => getDailyCheckIns(date, zonedStartOfDay(date, tz), zonedStartOfDay(addDays(date, 1), tz)),
    [date, tz], ['care_events', 'patient_responses', 'messages', 'alerts']);
  const data = query.data?.date === date ? query.data : undefined;
  const links = new Set(data?.links.map((l) => l.event_id) ?? []);
  const roots = (data?.events ?? []).filter((e) => !links.has(e.id));
  const childByResponse = new Map<string, CareEvent>();
  for (const link of data?.links ?? []) {
    const child = data?.events.find((e) => e.id === link.event_id);
    if (child) childByResponse.set(link.parent_response_id, child);
  }
  const selectedPatient = patients.find((p) => p.id === selected && p.status === 'ACTIVE');
  const daily = (id: string) => roots.filter((e) => e.patient_id === id);
  function navigate(day: string, patient = selected) {
    const next = new URLSearchParams({ date: day });
    if (patient) next.set('patient', patient);
    setParams(next);
  }
  const rows = patients.filter((p) => p.status === 'ACTIVE').map((p) => {
    const ev = daily(p.id);
    return { p, ev, answered: data ? ev.filter((e) => answerOf(e, data)).length : 0,
      review: data ? data.events.some((e) => e.patient_id === p.id && needsReview(e, data)) : false, overdue: ev.some(overdue),
      waiting: data ? ev.some((e) => !answerOf(e, data) && !overdue(e)) : false };
  }).filter((r) => r.p.name.toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || (filter === 'review' && r.review) || (filter === 'overdue' && r.overdue) || (filter === 'waiting' && r.waiting)))
    .sort((a, b) => Number(b.review) - Number(a.review) || Number(b.overdue) - Number(a.overdue) || a.p.name.localeCompare(b.p.name));
  const answered = data ? roots.filter((e) => answerOf(e, data)).length : 0;
  const late = roots.filter(overdue).length;

  return <>
    <PageHeader title="Daily check-in" subtitle="Review patient answers and send guided follow-up questions."
      actions={<div className="checkin-date"><button className="btn" aria-label="Previous day" onClick={() => navigate(addDays(date, -1))}>←</button>
        <input aria-label="Check-in date" type="date" value={date} onChange={(e) => e.target.value && navigate(e.target.value)} />
        <button className="btn" aria-label="Next day" onClick={() => navigate(addDays(date, 1))}>→</button>
        <button className="btn" onClick={() => navigate(todayIn(tz))}>Today</button></div>} />
    <ErrorBox error={query.error} />
    {!data && !query.error ? <Spinner label="Loading check-ins…" /> : data && <>
      <div className="checkin-stats" aria-label="Daily check-in summary">
        <span><strong>{roots.length}</strong> scheduled</span><span><strong>{answered}</strong> answered</span>
        <span><strong>{Math.max(0, roots.length - answered - late)}</strong> awaiting</span>
        <span><strong>{late}</strong> overdue</span><span><strong>{data.events.filter((e) => needsReview(e, data)).length}</strong> need review</span>
      </div>
      <div className={`checkins-layout ${selectedPatient ? 'has-selection' : ''}`}>
        <Card pad={false} className="patient-picker" title="Patients">
          <div className="checkin-picker-controls"><input aria-label="Search patients" placeholder="Search patients" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="Filter patients" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All patients</option><option value="review">Needs review</option>
              <option value="waiting">Awaiting response</option><option value="overdue">Overdue</option></select></div>
          {rows.length === 0 ? <Empty>No patients match this view.</Empty> : <ul className="picker-list">{rows.map(({ p, ev, answered: count, review, overdue: isLate }) => <li key={p.id}>
            <button className={`picker-item ${selected === p.id ? 'active' : ''}`} onClick={() => navigate(date, p.id)}>
              <PatientAvatar patient={p} size={40} /><span className="grow"><strong>{p.name}</strong>
                <span className="muted small">{ev.length ? `${count} of ${ev.length} answered` : 'Nothing scheduled'}</span></span>
              {review ? <Badge tone="warning">Review</Badge> : isLate ? <Badge tone="danger">Overdue</Badge> : null}
            </button></li>)}</ul>}
        </Card>
        <Card className="responses-card" title={selectedPatient?.name ?? 'Patient check-in'}
          actions={selectedPatient ? <button className="link checkins-back" onClick={() => navigate(date, '')}>← All patients</button> : undefined}>
          {!selectedPatient ? <Empty>Select a patient to review {formatDateKey(date)}.</Empty> : <>
            <div className="checkin-patient-meta"><span>{formatDateKey(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <span>{deviceByPatient.has(selectedPatient.id) ? 'P-kun assigned' : 'No P-kun assigned'}</span>
              <Link to={`/patients/${selectedPatient.id}?tab=responses`}>Open patient profile</Link></div>
            {daily(selectedPatient.id).length === 0 ? <Empty>Nothing scheduled for this patient today.</Empty> :
              <div className="checkin-questions">{daily(selectedPatient.id).map((e) => <QuestionCard key={e.id} event={e} data={data}
                childByResponse={childByResponse} tz={tz} onFollowUp={setFollowUp} />)}</div>}
            <section className="checkin-requests"><h3>Patient requests</h3>
              {data.requests.filter((m) => m.patient_id === selectedPatient.id).length === 0 ? <p className="muted">No requests on this date.</p> :
                data.requests.filter((m) => m.patient_id === selectedPatient.id).map((m) => <div className="checkin-request" key={m.id}>
                  <Badge tone={m.request_code === 'HELP' || m.request_code === 'NOT_RIGHT' ? 'danger' : 'warning'}>{m.message}</Badge>
                  <span>{formatDateTime(m.created_at, tz)}</span><Link to="/alerts">View alerts</Link></div>)}</section>
          </>}
        </Card>
      </div>
    </>}
    {followUp && data && <FollowUpDialog event={followUp} response={answerOf(followUp, data)!}
      patientName={selectedPatient?.name ?? 'Patient'} onClose={() => setFollowUp(null)}
      onSent={() => { setFollowUp(null); query.reload(); }} />}
  </>;
}

function QuestionCard({ event, data, childByResponse, tz, onFollowUp, depth = 0 }: {
  event: CareEvent; data: DailyCheckIns; childByResponse: Map<string, CareEvent>; tz: string;
  onFollowUp: (e: CareEvent) => void; depth?: number;
}) {
  const response = answerOf(event, data);
  const child = response && childByResponse.get(response.id);
  const status = response ? 'Answered' : overdue(event) ? 'Overdue' : new Date(event.scheduled_at) > new Date() ? 'Scheduled' : 'Awaiting response';
  return <article className={`checkin-question ${depth ? 'is-followup' : ''}`}>
    <div className="checkin-card-top"><span className="checkin-kicker">{depth ? 'Follow-up' : 'Daily question'} · {formatDateTime(event.scheduled_at, tz)}</span>
      <Badge tone={needsReview(event, data) ? 'warning' : response ? 'success' : status === 'Overdue' ? 'danger' : 'neutral'}>
        {needsReview(event, data) ? 'Needs review' : status}</Badge></div>
    <h3>{event.title}</h3>
    {response ? <><div className="checkin-answer">{response.response}</div><p className="checkin-meta">Answered {formatDateTime(response.response_time, tz)}
      {concerning(event, data) && !needsReview(event, data) ? ' · Concerning answer; alert reviewed' : ''}</p>
      {needsReview(event, data) && <Link to="/alerts">View alert</Link>}</> :
      <p className="muted">{status === 'Overdue' ? 'No answer received before the deadline.' : status === 'Scheduled' ? 'Scheduled for later.' : 'Waiting for the patient to answer.'}</p>}
    {response && !child && <button className="btn checkin-follow-button" onClick={() => onFollowUp(event)}>Ask follow-up</button>}
    {child && <QuestionCard event={child} data={data} childByResponse={childByResponse} tz={tz} onFollowUp={onFollowUp} depth={depth + 1} />}
  </article>;
}

function FollowUpDialog({ event, response, patientName, onClose, onSent }: {
  event: CareEvent; response: PatientResponse; patientName: string; onClose: () => void; onSent: () => void;
}) {
  const [template, setTemplate] = useState(-1);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [concerningAnswers, setConcerningAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = answers.map((a) => a.trim());
  const valid = question.trim().length > 0 && question.trim().length <= 200 && clean.every((a) => a.length > 0 && a.length <= 80)
    && new Set(clean).size === clean.length;
  async function send() {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try { await sendFollowUp(response.id, question.trim(), clean, concerningAnswers); onSent(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return <Modal title={`Ask ${patientName} a follow-up`} onClose={onClose} wide footer={<>
    <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    <button className="btn btn-primary" onClick={send} disabled={!valid || busy}>{busy ? 'Sending…' : 'Send question'}</button>
  </>}>
    <p className="checkin-source"><strong>{event.title}</strong><br />Patient answered: {response.response}</p>
    <Field label="Question pattern"><select value={template} onChange={(e) => {
      const i = Number(e.target.value); setTemplate(i);
      if (i >= 0) { setQuestion(templates[i].question); setAnswers([...templates[i].answers]); setConcerningAnswers([]); }
    }}><option value={-1}>Custom question</option>{templates.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}</select></Field>
    <Field label="Question shown on P-kun"><input maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
    <div className="checkin-option-editor"><strong>Answer buttons</strong><p className="muted">The patient will tap one of these. No typing is needed.</p>
      {answers.map((answer, i) => <div className="checkin-option-row" key={i}>
        <input aria-label={`Answer option ${i + 1}`} maxLength={80} value={answer} onChange={(e) => {
          setConcerningAnswers((old) => old.map((a) => a === answer ? e.target.value : a));
          setAnswers((old) => old.map((a, j) => j === i ? e.target.value : a));
        }} />
        <label><input type="checkbox" checked={concerningAnswers.includes(answer) && !!answer.trim()} disabled={!answer.trim()}
          onChange={() => setConcerningAnswers((old) => old.includes(answer) ? old.filter((a) => a !== answer) : [...old, answer])} /> Alert</label>
        <button className="btn" aria-label={`Remove option ${i + 1}`} disabled={answers.length <= 2} onClick={() => {
          setConcerningAnswers((old) => old.filter((a) => a !== answer)); setAnswers((old) => old.filter((_, j) => j !== i));
        }}>Remove</button></div>)}
      <button className="btn" disabled={answers.length >= 5} onClick={() => setAnswers((old) => [...old, ''])}>Add answer</button>
    </div>
    <div className="checkin-preview"><strong>Patient preview</strong><p>{question || 'Your question will appear here'}</p>
      <div>{clean.filter(Boolean).map((a, i) => <span key={i}>{a}</span>)}</div></div>
    <ErrorBox error={error} />
  </Modal>;
}

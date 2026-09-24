import { useMemo, useState } from 'react';
import { Modal, Field, ErrorBox } from '@/components/ui';
import { EVENT_TYPES, EVENT_TYPE_META, MEAL_TYPES, DEFAULT_MEAL_TIMES } from '@/lib/constants';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useToast } from '@/contexts/ToastContext';
import { titleCase } from '@/utils/format';
import { todayIn } from '@/utils/dates';
import type { AnySchedule, CareEvent, EventType, MealType, Recurrence, SourceTable } from '@/types/db';
import {
  activityFromEvent, activityFromSchedule, createActivity, emptyActivity, replaceOccurrence,
  updateOneOffEvent, updateSchedule, validateActivity, type ActivityInput,
} from './activity';

export type ActivityFormMode =
  | { kind: 'create'; initial?: Partial<ActivityInput>; lockPatient?: boolean; lockType?: boolean }
  | { kind: 'edit-event'; event: CareEvent }
  | { kind: 'edit-schedule'; table: SourceTable; schedule: AnySchedule };

export function ActivityFormModal({ mode, onClose, onSaved }: { mode: ActivityFormMode; onClose: () => void; onSaved?: () => void }) {
  const { orgId, tz } = useCaregiver();
  const { patients } = useReferenceData();
  const toast = useToast();

  const [form, setForm] = useState<ActivityInput>(() => {
    if (mode.kind === 'edit-event') return activityFromEvent(mode.event);
    if (mode.kind === 'edit-schedule') return activityFromSchedule(mode.table, mode.schedule);
    return emptyActivity({ date: todayIn(tz), ...mode.initial });
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOccurrence = mode.kind === 'edit-event' && mode.event.source_table != null;
  const lockPatient = mode.kind !== 'create' || mode.lockPatient;
  const lockType = mode.kind !== 'create' || mode.lockType;
  const recurrenceEditable = mode.kind !== 'edit-event';

  const set = <K extends keyof ActivityInput>(k: K, v: ActivityInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const activePatients = useMemo(() => patients.filter((p) => p.status === 'ACTIVE' || p.id === form.patient_id), [patients, form.patient_id]);

  const title =
    mode.kind === 'create' ? 'New care event'
      : mode.kind === 'edit-schedule' ? `Edit recurring ${EVENT_TYPE_META[form.event_type].label.toLowerCase()}`
        : isOccurrence ? 'Edit this occurrence' : 'Edit care event';

  const save = async () => {
    const v = validateActivity(form);
    if (v) { setError(v); return; }
    setBusy(true); setError(null);
    try {
      if (mode.kind === 'create') {
        await createActivity(orgId, tz, form);
        toast({ kind: 'success', title: form.recurrence === 'ONCE' ? 'Event created' : 'Recurring schedule created', body: 'P-kun will receive it automatically.' });
      } else if (mode.kind === 'edit-schedule') {
        await updateSchedule(mode.table, mode.schedule.id, form);
        toast({ kind: 'success', title: 'Schedule updated', body: 'Upcoming occurrences were refreshed.' });
      } else if (isOccurrence) {
        await replaceOccurrence(orgId, tz, mode.event, form);
        toast({ kind: 'success', title: 'Occurrence updated' });
      } else {
        await updateOneOffEvent(mode.event, form);
        toast({ kind: 'success', title: 'Event updated' });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {isOccurrence && (
        <p className="note">This event belongs to a recurring schedule. Saving replaces only this date; the rest of the series is unchanged.</p>
      )}
      <div className="form-grid">
        <Field label="Patient">
          <select value={form.patient_id} onChange={(e) => set('patient_id', e.target.value)} disabled={lockPatient}>
            <option value="">Select a patient…</option>
            {activePatients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Event type">
          <select value={form.event_type} disabled={lockType} onChange={(e) => {
            const t = e.target.value as EventType;
            setForm((f) => ({ ...f, event_type: t, time: t === 'MEAL' ? DEFAULT_MEAL_TIMES[f.meal_type] : f.time }));
          }}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].icon} {EVENT_TYPE_META[t].label}</option>)}
          </select>
        </Field>
        <Field label={form.recurrence === 'ONCE' ? 'Date' : 'Start date'}>
          <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Time">
          <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
        </Field>
        <Field label="Recurrence" hint={!recurrenceEditable ? 'Edit the series from the patient’s Care activities tab.' : form.recurrence === 'WEEKLY' ? 'Repeats on the start date’s weekday.' : undefined}>
          <select value={form.recurrence} disabled={!recurrenceEditable} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
            <option value="ONCE">Does not repeat</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </select>
        </Field>
        {form.recurrence !== 'ONCE' && (
          <Field label="End date (optional)">
            <input type="date" value={form.end_date} min={form.date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
        )}
      </div>

      <h3 className="section-title">{EVENT_TYPE_META[form.event_type].icon} {EVENT_TYPE_META[form.event_type].label} details</h3>
      <p className="muted small">These details are shown to the patient on P-kun. Do not enter private care notes here.</p>
      <div className="form-grid">
        {form.event_type === 'DAILY_CHECK_IN' && <CheckInFields form={form} setForm={setForm} />}
        {form.event_type === 'MEDICINE' && (
          <>
            <Field label="Medicine name"><input value={form.med_name} onChange={(e) => set('med_name', e.target.value)} maxLength={120} /></Field>
            <Field label="Dosage"><input value={form.dosage} onChange={(e) => set('dosage', e.target.value)} placeholder="e.g. 1 tablet" maxLength={120} /></Field>
            <Field label="Instructions" full><input value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Take with water after breakfast" maxLength={300} /></Field>
          </>
        )}
        {form.event_type === 'MEAL' && (
          <>
            <Field label="Meal type">
              <select value={form.meal_type} onChange={(e) => {
                const m = e.target.value as MealType;
                setForm((f) => ({ ...f, meal_type: m, time: mode.kind === 'create' ? DEFAULT_MEAL_TIMES[m] : f.time }));
              }}>
                {MEAL_TYPES.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
              </select>
            </Field>
            <Field label="Description (optional)"><input value={form.meal_description} onChange={(e) => set('meal_description', e.target.value)} placeholder="e.g. Rice porridge" maxLength={200} /></Field>
          </>
        )}
        {form.event_type === 'TASK' && (
          <>
            <Field label="Task name"><input value={form.task_title} onChange={(e) => set('task_title', e.target.value)} placeholder="e.g. Drink a glass of water" maxLength={200} /></Field>
            <Field label="Description (optional)"><input value={form.task_description} onChange={(e) => set('task_description', e.target.value)} maxLength={300} /></Field>
            <p className="muted small field-full">Task reminders show on P-kun for 15 seconds and do not ask for confirmation.</p>
          </>
        )}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

function CheckInFields({ form, setForm }: { form: ActivityInput; setForm: React.Dispatch<React.SetStateAction<ActivityInput>> }) {
  const updateAnswer = (i: number, v: string) => setForm((f) => {
    const old = f.answers[i];
    const answers = f.answers.map((a, j) => (j === i ? v : a));
    const concerning_answers = f.concerning_answers.map((c) => (c === old ? v : c));
    return { ...f, answers, concerning_answers };
  });
  const toggleConcerning = (a: string) => setForm((f) => ({
    ...f,
    concerning_answers: f.concerning_answers.includes(a) ? f.concerning_answers.filter((c) => c !== a) : [...f.concerning_answers, a],
  }));
  const remove = (i: number) => setForm((f) => ({
    ...f, answers: f.answers.filter((_, j) => j !== i), concerning_answers: f.concerning_answers.filter((c) => c !== f.answers[i]),
  }));
  return (
    <>
      <Field label="Question" full>
        <input value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} maxLength={200} />
      </Field>
      <div className="field field-full">
        <span className="field-label">Preset answers <span className="muted">(tick answers that should alert a caretaker)</span></span>
        <div className="answer-list">
          {form.answers.map((a, i) => (
            <div key={i} className="answer-row">
              <input value={a} onChange={(e) => updateAnswer(i, e.target.value)} placeholder={`Answer ${i + 1}`} maxLength={60} />
              <label className={`concern-toggle ${form.concerning_answers.includes(a) && a ? 'on' : ''}`}>
                <input type="checkbox" checked={!!a && form.concerning_answers.includes(a)} disabled={!a} onChange={() => toggleConcerning(a)} />
                Concerning
              </label>
              <button type="button" className="icon-btn" onClick={() => remove(i)} disabled={form.answers.length <= 2} aria-label="Remove answer">✕</button>
            </div>
          ))}
          {form.answers.length < 6 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm((f) => ({ ...f, answers: [...f.answers, ''] }))}>+ Add answer</button>
          )}
        </div>
      </div>
    </>
  );
}

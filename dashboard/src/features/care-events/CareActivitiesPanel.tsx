import { useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useData } from '@/hooks/useData';
import { Card, Badge, Empty, Spinner, ErrorBox } from '@/components/ui';
import { EVENT_TYPE_META, EVENT_TYPE_FOR_SOURCE, DEFAULT_MEAL_TIMES } from '@/lib/constants';
import { supabase, unwrap } from '@/lib/supabase';
import { formatDateKey, hhmm, todayIn } from '@/utils/dates';
import { titleCase } from '@/utils/format';
import type {
  AnySchedule, CheckInQuestion, MealSchedule, MealType, MedicineSchedule, SourceTable, TaskSchedule,
} from '@/types/db';
import { listSchedules, refreshSchedules, setScheduleEnabled } from './activity';
import { ActivityFormModal, type ActivityFormMode } from './ActivityForm';

const SECTIONS: SourceTable[] = ['check_in_questions', 'medicines', 'meals', 'tasks'];

/** Recurring configuration for one patient: check-ins, medicines, meals, tasks. */
export function CareActivitiesPanel({ patientId }: { patientId: string }) {
  const [mode, setMode] = useState<ActivityFormMode | null>(null);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <>
      <p className="muted">
        Recurring activities generate dated events on the calendar (7 days ahead) and are delivered to P-kun automatically.
        Disable a schedule to stop future occurrences; history is kept.
      </p>
      <div className="stack">
        {SECTIONS.map((t) => (
          <ScheduleSection key={t} table={t} patientId={patientId} version={version} onEdit={setMode} onChanged={bump} />
        ))}
      </div>
      {mode && <ActivityFormModal mode={mode} onClose={() => setMode(null)} onSaved={bump} />}
    </>
  );
}

function ScheduleSection({ table, patientId, version, onEdit, onChanged }: {
  table: SourceTable; patientId: string; version: number;
  onEdit: (m: ActivityFormMode) => void; onChanged: () => void;
}) {
  const { orgId, tz } = useCaregiver();
  const toast = useToast();
  const type = EVENT_TYPE_FOR_SOURCE[table];
  const meta = EVENT_TYPE_META[type];
  const { data, loading, error } = useData(() => listSchedules<AnySchedule>(table, patientId), [table, patientId, version]);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (s: AnySchedule) => {
    setBusy(s.id);
    try { await setScheduleEnabled(table, s.id, !s.enabled); onChanged(); }
    catch (e) { toast({ kind: 'error', title: 'Could not update', body: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const addDefaultMeals = async () => {
    setBusy('meals');
    try {
      const rows = (['BREAKFAST', 'LUNCH', 'DINNER'] as MealType[]).map((m) => ({
        organization_id: orgId, patient_id: patientId, meal_type: m, scheduled_time: DEFAULT_MEAL_TIMES[m],
        recurrence: 'DAILY', start_date: todayIn(tz),
      }));
      unwrap(await supabase.from('meals').insert(rows));
      await refreshSchedules();
      toast({ kind: 'success', title: 'Default meals added', body: 'Breakfast 08:00, lunch 12:00, dinner 18:00 daily.' });
      onChanged();
    } catch (e) { toast({ kind: 'error', title: 'Could not add meals', body: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const describe = (s: AnySchedule): { title: string; detail: string } => {
    switch (table) {
      case 'check_in_questions': { const c = s as CheckInQuestion; return { title: c.question, detail: `Answers: ${c.answers.join(' / ')}${c.concerning_answers.length ? ` · alerts on: ${c.concerning_answers.join(', ')}` : ''}` }; }
      case 'medicines': { const m = s as MedicineSchedule; return { title: `${m.name} — ${m.dosage}`, detail: m.instructions ?? '' }; }
      case 'meals': { const m = s as MealSchedule; return { title: titleCase(m.meal_type), detail: m.description ?? '' }; }
      case 'tasks': { const t = s as TaskSchedule; return { title: t.title, detail: t.description ?? '' }; }
    }
  };

  const recurrenceText = (s: AnySchedule) => {
    const r = s.recurrence === 'ONCE' ? `Once on ${formatDateKey(s.start_date)}`
      : s.recurrence === 'WEEKLY' ? `Weekly on ${formatDateKey(s.start_date, { weekday: 'long' })}s` : 'Daily';
    return `${r}${s.recurrence !== 'ONCE' && s.end_date ? ` until ${formatDateKey(s.end_date)}` : ''}`;
  };

  return (
    <Card
      title={meta.label === 'Daily check-in' ? 'Daily check-ins' : meta.label === 'Task reminder' ? 'Task reminders' : `${meta.label}s`}
      actions={
        <>
          {table === 'meals' && data && data.length === 0 && (
            <button className="btn btn-sm btn-ghost" onClick={addDefaultMeals} disabled={busy === 'meals'}>Add default meals</button>
          )}
          <button className="btn btn-sm" onClick={() => onEdit({ kind: 'create', lockPatient: true, lockType: true, initial: { patient_id: patientId, event_type: type, recurrence: 'DAILY', time: type === 'MEAL' ? '08:00' : '09:00' } })}>+ Add</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {loading ? <Spinner /> : !data?.length ? <Empty>None configured.</Empty> : (
        <ul className="list">
          {data.map((s) => {
            const d = describe(s);
            return (
              <li key={s.id} className={`list-item ${s.enabled ? '' : 'disabled'}`}>
                <span className="time-pill">{hhmm(s.scheduled_time)}</span>
                <div className="grow">
                  <strong>{d.title}</strong>
                  <div className="muted small">{recurrenceText(s)}{d.detail ? ` · ${d.detail}` : ''}</div>
                </div>
                {!s.enabled && <Badge tone="muted">Disabled</Badge>}
                <button className="btn btn-sm btn-ghost" onClick={() => onEdit({ kind: 'edit-schedule', table, schedule: s })}>Edit</button>
                <label className="switch" title={s.enabled ? 'Disable' : 'Enable'}>
                  <input type="checkbox" checked={s.enabled} disabled={busy === s.id} onChange={() => toggle(s)} />
                  <span />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

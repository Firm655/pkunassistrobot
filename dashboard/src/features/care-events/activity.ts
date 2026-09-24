import { supabase, unwrap } from '@/lib/supabase';
import { SOURCE_TABLE_FOR } from '@/lib/constants';
import type {
  AnySchedule, CareEvent, CheckInQuestion, EventType, MealSchedule, MealType,
  MedicineSchedule, Recurrence, SourceTable, TaskSchedule,
} from '@/types/db';

/**
 * Unified form model for creating/editing a care activity, used both for dated one-off
 * events (care_events) and recurring configurations (check_in_questions, medicines, ...).
 *
 * Patient-facing fields only. Caretaker-only care notes live on `patients` and are never
 * copied into event payloads/descriptions (P-kun can read events, not patients).
 */
export interface ActivityInput {
  patient_id: string;
  event_type: EventType;
  date: string; // YYYY-MM-DD (start date for recurring)
  time: string; // HH:MM
  recurrence: Recurrence;
  end_date: string; // '' = open-ended
  question: string;
  answers: string[];
  concerning_answers: string[];
  med_name: string;
  dosage: string;
  instructions: string;
  meal_type: MealType;
  meal_description: string;
  task_title: string;
  task_description: string;
}

export function emptyActivity(partial: Partial<ActivityInput> = {}): ActivityInput {
  return {
    patient_id: '', event_type: 'MEDICINE', date: '', time: '09:00', recurrence: 'ONCE', end_date: '',
    question: 'How are you feeling today?', answers: ['Good', 'Okay', 'Not well'], concerning_answers: ['Not well'],
    med_name: '', dosage: '', instructions: '',
    meal_type: 'BREAKFAST', meal_description: '',
    task_title: '', task_description: '',
    ...partial,
  };
}

export function validateActivity(a: ActivityInput): string | null {
  if (!a.patient_id) return 'Select a patient.';
  if (!a.date) return 'Select a date.';
  if (!a.time) return 'Select a time.';
  if (a.recurrence !== 'ONCE' && a.end_date && a.end_date < a.date) return 'End date must be after the start date.';
  switch (a.event_type) {
    case 'DAILY_CHECK_IN': {
      if (!a.question.trim()) return 'Enter a question.';
      const answers = a.answers.map((x) => x.trim()).filter(Boolean);
      if (answers.length < 2) return 'Provide at least two answers.';
      if (new Set(answers).size !== answers.length) return 'Answers must be unique.';
      return null;
    }
    case 'MEDICINE':
      if (!a.med_name.trim()) return 'Enter the medicine name.';
      if (!a.dosage.trim()) return 'Enter the dosage.';
      return null;
    case 'TASK':
      return a.task_title.trim() ? null : 'Enter a task name.';
    default:
      return null;
  }
}

const clean = (v: string) => (v.trim() ? v.trim() : null);

function checkInLists(a: ActivityInput) {
  const answers = a.answers.map((x) => x.trim()).filter(Boolean);
  const concerning = a.concerning_answers.filter((c) => answers.includes(c));
  return { answers, concerning };
}

/** Title / description / payload for a dated care_event (mirrors backend materialize_schedules). */
export function toEventFields(a: ActivityInput) {
  switch (a.event_type) {
    case 'DAILY_CHECK_IN': {
      const { answers, concerning } = checkInLists(a);
      return { title: a.question.trim(), description: null, payload: { answers, concerning_answers: concerning } };
    }
    case 'MEDICINE':
      return {
        title: a.med_name.trim(), description: clean(a.instructions),
        payload: { name: a.med_name.trim(), dosage: a.dosage.trim(), instructions: clean(a.instructions) },
      };
    case 'MEAL':
      return { title: a.meal_type, description: clean(a.meal_description), payload: { meal_type: a.meal_type } };
    case 'TASK':
      return { title: a.task_title.trim(), description: clean(a.task_description), payload: {} };
  }
}

/** Columns for a recurring configuration row. */
function toScheduleRow(a: ActivityInput) {
  const base = {
    patient_id: a.patient_id, scheduled_time: a.time, recurrence: a.recurrence,
    start_date: a.date, end_date: a.end_date || null,
  };
  switch (a.event_type) {
    case 'DAILY_CHECK_IN': {
      const { answers, concerning } = checkInLists(a);
      return { ...base, question: a.question.trim(), answers, concerning_answers: concerning };
    }
    case 'MEDICINE':
      return { ...base, name: a.med_name.trim(), dosage: a.dosage.trim(), instructions: clean(a.instructions) };
    case 'MEAL':
      return { ...base, meal_type: a.meal_type, description: clean(a.meal_description) };
    case 'TASK':
      return { ...base, title: a.task_title.trim(), description: clean(a.task_description) };
  }
}

export function activityFromEvent(e: CareEvent): ActivityInput {
  const p = e.payload as Record<string, unknown>;
  return emptyActivity({
    patient_id: e.patient_id, event_type: e.event_type, date: e.scheduled_date, time: e.scheduled_time.slice(0, 5),
    recurrence: 'ONCE',
    question: e.event_type === 'DAILY_CHECK_IN' ? e.title : undefined,
    answers: Array.isArray(p.answers) ? (p.answers as string[]) : undefined,
    concerning_answers: Array.isArray(p.concerning_answers) ? (p.concerning_answers as string[]) : undefined,
    med_name: (p.name as string) ?? (e.event_type === 'MEDICINE' ? e.title : ''),
    dosage: (p.dosage as string) ?? '',
    instructions: (p.instructions as string) ?? '',
    meal_type: (p.meal_type as MealType) ?? 'BREAKFAST',
    meal_description: e.event_type === 'MEAL' ? e.description ?? '' : '',
    task_title: e.event_type === 'TASK' ? e.title : '',
    task_description: e.event_type === 'TASK' ? e.description ?? '' : '',
  });
}

export function activityFromSchedule(table: SourceTable, s: AnySchedule): ActivityInput {
  const base = {
    patient_id: s.patient_id, date: s.start_date, time: s.scheduled_time.slice(0, 5),
    recurrence: s.recurrence, end_date: s.end_date ?? '',
  };
  switch (table) {
    case 'check_in_questions': {
      const c = s as CheckInQuestion;
      return emptyActivity({ ...base, event_type: 'DAILY_CHECK_IN', question: c.question, answers: c.answers, concerning_answers: c.concerning_answers });
    }
    case 'medicines': {
      const m = s as MedicineSchedule;
      return emptyActivity({ ...base, event_type: 'MEDICINE', med_name: m.name, dosage: m.dosage, instructions: m.instructions ?? '' });
    }
    case 'meals': {
      const m = s as MealSchedule;
      return emptyActivity({ ...base, event_type: 'MEAL', meal_type: m.meal_type, meal_description: m.description ?? '' });
    }
    case 'tasks': {
      const t = s as TaskSchedule;
      return emptyActivity({ ...base, event_type: 'TASK', task_title: t.title, task_description: t.description ?? '' });
    }
  }
}

// ---------- API ----------

export async function refreshSchedules(horizonDays = 7) {
  unwrap(await supabase.rpc('refresh_schedules', { horizon_days: horizonDays }));
}

/**
 * Create an activity. ONCE → a single dated care_event. DAILY/WEEKLY → a configuration row;
 * the backend expands it into dated care_events (refresh_schedules + the 1-minute cron).
 */
export async function createActivity(orgId: string, tz: string, a: ActivityInput) {
  if (a.recurrence === 'ONCE') {
    const f = toEventFields(a);
    return unwrap(await supabase.from('care_events').insert({
      organization_id: orgId, patient_id: a.patient_id, event_type: a.event_type,
      scheduled_date: a.date, scheduled_time: a.time, timezone: tz, recurrence: 'ONCE', ...f,
    }).select().single()) as CareEvent;
  }
  unwrap(await supabase.from(SOURCE_TABLE_FOR[a.event_type]).insert({ organization_id: orgId, ...toScheduleRow(a) }).select().single());
  await refreshSchedules();
  return null;
}

/** Update a one-off event in place. Moving it resets status so the device/cron re-evaluate it. */
export async function updateOneOffEvent(event: CareEvent, a: ActivityInput) {
  const f = toEventFields(a);
  return unwrap(await supabase.from('care_events').update({
    scheduled_date: a.date, scheduled_time: a.time, status: 'SCHEDULED', ...f,
  }).eq('id', event.id).select().single()) as CareEvent;
}

/**
 * Edit a single occurrence of a recurring series. The generated row is marked SKIPPED (it keeps
 * its unique source/date key so the scheduler won't regenerate it) and a one-off replacement is created.
 */
export async function replaceOccurrence(orgId: string, tz: string, event: CareEvent, a: ActivityInput) {
  await skipEvent(event.id);
  return createActivity(orgId, tz, { ...a, recurrence: 'ONCE' });
}

export async function skipEvent(id: string) {
  unwrap(await supabase.from('care_events').update({ status: 'SKIPPED' }).eq('id', id));
}

export async function listSchedules<T extends AnySchedule>(table: SourceTable, patientId: string): Promise<T[]> {
  return unwrap(await supabase.from(table).select('*').eq('patient_id', patientId)
    .order('enabled', { ascending: false }).order('scheduled_time')) as T[];
}

export async function getSchedule(table: SourceTable, id: string): Promise<AnySchedule> {
  return unwrap(await supabase.from(table).select('*').eq('id', id).single()) as AnySchedule;
}

export async function updateSchedule(table: SourceTable, id: string, a: ActivityInput) {
  const { patient_id: _ignored, ...row } = toScheduleRow(a);
  unwrap(await supabase.from(table).update(row).eq('id', id));
  await refreshSchedules();
}

export async function setScheduleEnabled(table: SourceTable, id: string, enabled: boolean) {
  unwrap(await supabase.from(table).update({ enabled }).eq('id', id));
  await refreshSchedules();
}

export interface EventQuery {
  from: string;
  to: string;
  patientId?: string;
  types?: EventType[];
  statuses?: string[];
  includeSkipped?: boolean;
  limit?: number;
}

export async function listEvents(q: EventQuery): Promise<CareEvent[]> {
  let query = supabase.from('care_events').select('*')
    .gte('scheduled_date', q.from).lte('scheduled_date', q.to)
    .order('scheduled_date').order('scheduled_time').limit(q.limit ?? 2000);
  if (q.patientId) query = query.eq('patient_id', q.patientId);
  if (q.types?.length) query = query.in('event_type', q.types);
  if (q.statuses?.length) query = query.in('status', q.statuses);
  else if (!q.includeSkipped) query = query.neq('status', 'SKIPPED');
  return unwrap(await query) as CareEvent[];
}

export async function getEvent(id: string): Promise<CareEvent | null> {
  return unwrap(await supabase.from('care_events').select('*').eq('id', id).maybeSingle()) as CareEvent | null;
}

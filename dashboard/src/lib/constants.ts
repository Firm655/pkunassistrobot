import type { AlertType, EventStatus, EventType, MealType, Priority, SourceTable } from '@/types/db';

export const EVENT_TYPES: EventType[] = ['DAILY_CHECK_IN', 'MEDICINE', 'MEAL', 'TASK'];
export const EVENT_STATUSES: EventStatus[] = ['SCHEDULED', 'PENDING', 'COMPLETED', 'MISSED', 'ALERT', 'SKIPPED'];
export const MEAL_TYPES: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

export const EVENT_TYPE_META: Record<EventType, { label: string; short: string; color: string; icon: string }> = {
  DAILY_CHECK_IN: { label: 'Daily check-in', short: 'Check-in', color: '#2563eb', icon: '💬' },
  MEDICINE: { label: 'Medicine', short: 'Medicine', color: '#9333ea', icon: '💊' },
  MEAL: { label: 'Meal', short: 'Meal', color: '#d97706', icon: '🍽️' },
  TASK: { label: 'Task reminder', short: 'Task', color: '#0d9488', icon: '📋' },
};

export const STATUS_META: Record<EventStatus, { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  MISSED: { label: 'Missed', tone: 'warning' },
  ALERT: { label: 'Alert', tone: 'danger' },
  SKIPPED: { label: 'Skipped', tone: 'muted' },
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

export const PRIORITY_META: Record<Priority, { label: string; tone: Tone }> = {
  NORMAL: { label: 'Normal', tone: 'neutral' },
  ATTENTION: { label: 'Attention', tone: 'warning' },
  HIGH: { label: 'High', tone: 'danger' },
};

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  MEDICINE_NOT_TAKEN: 'Medicine not taken',
  MEAL_NOT_COMPLETED: 'Meal not completed',
  CONCERNING_CHECK_IN: 'Concerning check-in',
  PATIENT_HELP_REQUEST: 'Help request',
  PATIENT_SOMETHING_WRONG: "Something isn't right",
  MISSED_EVENT: 'Missed event',
  DEVICE_OFFLINE: 'Device offline',
};

export const SOURCE_TABLE_FOR: Record<EventType, SourceTable> = {
  DAILY_CHECK_IN: 'check_in_questions',
  MEDICINE: 'medicines',
  MEAL: 'meals',
  TASK: 'tasks',
};

export const EVENT_TYPE_FOR_SOURCE: Record<SourceTable, EventType> = {
  check_in_questions: 'DAILY_CHECK_IN',
  medicines: 'MEDICINE',
  meals: 'MEAL',
  tasks: 'TASK',
};

export const DEFAULT_MEAL_TIMES: Record<MealType, string> = {
  BREAKFAST: '08:00',
  LUNCH: '12:00',
  DINNER: '18:00',
  SNACK: '15:00',
};

export const DEFAULT_TIMEZONE = 'Asia/Bangkok';
/** A device is considered stale when no heartbeat for this long (backend alerts at 3 min). */
export const DEVICE_STALE_MS = 3 * 60 * 1000;

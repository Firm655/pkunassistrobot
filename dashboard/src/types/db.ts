// Hand-written row types mirroring supabase/migrations in the backend repo.
// Keep these in sync with the schema (or regenerate with `supabase gen types`).

export type Role = 'admin' | 'caretaker';
export type PatientStatus = 'ACTIVE' | 'INACTIVE';
export type EventType = 'DAILY_CHECK_IN' | 'MEDICINE' | 'TASK' | 'MEAL';
export type EventStatus = 'SCHEDULED' | 'PENDING' | 'COMPLETED' | 'MISSED' | 'ALERT' | 'SKIPPED';
export type Recurrence = 'ONCE' | 'DAILY' | 'WEEKLY';
export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
export type AlertType =
  | 'MEDICINE_NOT_TAKEN'
  | 'MEAL_NOT_COMPLETED'
  | 'CONCERNING_CHECK_IN'
  | 'PATIENT_HELP_REQUEST'
  | 'PATIENT_SOMETHING_WRONG'
  | 'MISSED_EVENT'
  | 'DEVICE_OFFLINE';
export type Priority = 'NORMAL' | 'ATTENTION' | 'HIGH';
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'PAIRING';
export type SourceTable = 'check_in_questions' | 'medicines' | 'meals' | 'tasks';

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  created_at: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  full_name: string;
  role: Role;
  created_at: string;
}

export interface EmergencyContact {
  name?: string;
  phone?: string;
  relationship?: string;
}

export interface Patient {
  id: string;
  organization_id: string;
  name: string;
  date_of_birth: string | null;
  age: number | null;
  profile_photo: string | null;
  assigned_caretaker_id: string | null;
  emergency_contact: EmergencyContact;
  status: PatientStatus;
  special_requirements: string | null;
  dietary_requirements: string | null;
  food_restrictions: string | null;
  allergies: string | null;
  mobility_notes: string | null;
  communication_preferences: string | null;
  behavioral_notes: string | null;
  other_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareEvent {
  id: string;
  organization_id: string;
  patient_id: string;
  event_type: EventType;
  title: string;
  description: string | null;
  scheduled_date: string; // YYYY-MM-DD (org-local)
  scheduled_time: string; // HH:MM:SS (org-local)
  timezone: string;
  scheduled_at: string;
  due_at: string;
  recurrence: Recurrence;
  source_table: SourceTable | null;
  source_id: string | null;
  status: EventStatus;
  response_required: boolean;
  payload: Record<string, unknown>;
  response_data: { response?: string; data?: Record<string, unknown> } & Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PatientResponse {
  id: string;
  organization_id: string;
  patient_id: string;
  event_id: string;
  device_id: string;
  response: string;
  response_data: Record<string, unknown>;
  response_time: string;
  received_at: string;
}

export interface Message {
  id: string;
  organization_id: string;
  patient_id: string;
  sender_type: 'CARETAKER' | 'PATIENT';
  sender_id: string;
  message_type: 'PRESET' | 'CUSTOM' | 'PATIENT_REQUEST';
  message: string;
  request_code: 'HELP' | 'HUNGRY' | 'NOT_RIGHT' | null;
  created_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
}

export interface Alert {
  id: string;
  organization_id: string;
  patient_id: string | null;
  event_id: string | null;
  device_id: string | null;
  alert_type: AlertType;
  message: string;
  priority: Priority;
  created_at: string;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface Device {
  id: string;
  organization_id: string;
  device_name: string;
  device_type: string;
  assigned_patient_id: string | null;
  status: DeviceStatus;
  last_seen: string | null;
  app_version: string | null;
  capabilities: Record<string, unknown>;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InteractionLog {
  id: string;
  organization_id: string;
  patient_id: string | null;
  device_id: string | null;
  event_id: string | null;
  action: string;
  data: Record<string, unknown>;
  created_at: string;
}

interface ScheduleBase {
  id: string;
  organization_id: string;
  patient_id: string;
  scheduled_time: string;
  recurrence: Recurrence;
  start_date: string;
  end_date: string | null;
  enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CheckInQuestion extends ScheduleBase {
  question: string;
  answers: string[];
  concerning_answers: string[];
}
export interface MedicineSchedule extends ScheduleBase {
  name: string;
  dosage: string;
  instructions: string | null;
}
export interface MealSchedule extends ScheduleBase {
  meal_type: MealType;
  description: string | null;
}
export interface TaskSchedule extends ScheduleBase {
  title: string;
  description: string | null;
}
export type AnySchedule = CheckInQuestion | MedicineSchedule | MealSchedule | TaskSchedule;

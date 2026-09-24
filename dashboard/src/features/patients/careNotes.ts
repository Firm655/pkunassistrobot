import type { Patient } from '@/types/db';

export type CareNoteKey = 'special_requirements' | 'dietary_requirements' | 'food_restrictions' | 'allergies'
  | 'mobility_notes' | 'communication_preferences' | 'behavioral_notes' | 'other_notes';

export const CARE_NOTE_FIELDS: [CareNoteKey, string][] = [
  ['special_requirements', 'Special requirements'],
  ['dietary_requirements', 'Dietary requirements'],
  ['food_restrictions', 'Food restrictions'],
  ['allergies', 'Allergies'],
  ['mobility_notes', 'Mobility considerations'],
  ['communication_preferences', 'Communication preferences'],
  ['behavioral_notes', 'Behavioral notes'],
  ['other_notes', 'Other important notes'],
];

export const hasCareNotes = (p: Patient) => CARE_NOTE_FIELDS.some(([k]) => !!p[k]);

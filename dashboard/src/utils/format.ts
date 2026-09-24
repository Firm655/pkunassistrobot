import type { CareEvent } from '@/types/db';

export function titleCase(v: string): string {
  return v.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human-friendly event title (generated meal events store the raw meal type as title). */
export function eventTitle(e: CareEvent): string {
  if (e.event_type === 'MEAL' && /^(BREAKFAST|LUNCH|DINNER|SNACK)$/.test(e.title)) return titleCase(e.title);
  return e.title;
}

/** Short summary of what the patient answered. */
export function responseSummary(e: CareEvent): string | null {
  const r = e.response_data?.response;
  if (!r) return null;
  if (e.event_type === 'MEDICINE') return r === 'YES' ? 'Taken' : r === 'NO' ? 'Not taken' : r;
  if (e.event_type === 'MEAL') return r === 'YES' ? 'Eaten' : r === 'NO' ? 'Not eaten' : r;
  if (e.event_type === 'TASK') return r === 'DISPLAYED' ? 'Shown on P-kun' : r;
  return r;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

import { supabase, unwrap } from '@/lib/supabase';
import type { Alert, CareEvent, PatientResponse, Message } from '@/types/db';

export interface FollowUpLink {
  event_id: string;
  parent_response_id: string;
  patient_id: string;
}

export interface DailyCheckIns {
  date: string;
  events: CareEvent[];
  responses: PatientResponse[];
  links: FollowUpLink[];
  requests: Message[];
  alerts: Alert[];
}

// PostgREST's row limit varies by deployment. Page explicitly so daily totals
// cannot silently be calculated from only the newest subset.
async function allPages<T>(fetch: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(await fetch(from, from + pageSize - 1)) as T[];
    result.push(...page);
    if (page.length < pageSize) return result;
  }
}

export async function getDailyCheckIns(date: string, dayStart: string, nextStart: string): Promise<DailyCheckIns> {
  const roots = await allPages<CareEvent>((from, to) => supabase.from('care_events').select('*')
    .eq('event_type', 'DAILY_CHECK_IN').eq('scheduled_date', date).neq('status', 'SKIPPED')
    .order('scheduled_at').order('id').range(from, to));
  const requests = await allPages<Message>((from, to) => supabase.from('messages').select('*')
    .eq('message_type', 'PATIENT_REQUEST').gte('created_at', dayStart).lt('created_at', nextStart)
    .order('created_at').order('id').range(from, to));
  const rootLinks: FollowUpLink[] = [];
  for (let i = 0; i < roots.length; i += 100) {
    const ids = roots.slice(i, i + 100).map((e) => e.id);
    if (ids.length) rootLinks.push(...(unwrap(await supabase.from('check_in_followups')
      .select('event_id,parent_response_id,patient_id').in('event_id', ids)) as FollowUpLink[]));
  }
  const linkedRootIds = new Set(rootLinks.map((l) => l.event_id));
  const dailyRoots = roots.filter((e) => !linkedRootIds.has(e.id));
  const events = new Map(dailyRoots.map((e) => [e.id, e]));
  const responses = new Map<string, PatientResponse>();
  const links = new Map<string, FollowUpLink>();
  let frontier = dailyRoots.map((e) => e.id);
  // Each answer has at most one follow-up. Walk links so a response on a later
  // date remains attached to the day of its original question.
  while (frontier.length) {
    const next: string[] = [];
    for (let i = 0; i < frontier.length; i += 100) {
      const ids = frontier.slice(i, i + 100);
      const batch = unwrap(await supabase.from('patient_responses').select('*').in('event_id', ids)) as PatientResponse[];
      for (const r of batch) responses.set(r.id, r);
      if (!batch.length) continue;
      const childLinks = unwrap(await supabase.from('check_in_followups').select('event_id,parent_response_id,patient_id')
        .in('parent_response_id', batch.map((r) => r.id))) as FollowUpLink[];
      for (const link of childLinks) {
        if (events.has(link.event_id)) continue;
        links.set(link.event_id, link);
        next.push(link.event_id);
      }
    }
    if (next.length) {
      for (let i = 0; i < next.length; i += 100) {
        const batch = unwrap(await supabase.from('care_events').select('*').in('id', next.slice(i, i + 100))) as CareEvent[];
        for (const e of batch) events.set(e.id, e);
      }
    }
    frontier = next;
  }
  // Exclude linked follow-ups from the daily scheduled question count.
  const alerts: Alert[] = [];
  const eventIds = [...events.keys()];
  for (let i = 0; i < eventIds.length; i += 100) {
    alerts.push(...(unwrap(await supabase.from('alerts').select('*').in('event_id', eventIds.slice(i, i + 100))) as Alert[]));
  }
  return { date, events: [...events.values()], responses: [...responses.values()], links: [...links.values()], requests, alerts };
}

export async function sendFollowUp(parentResponseId: string, question: string, answers: string[], concerningAnswers: string[]): Promise<string> {
  return unwrap(await supabase.rpc('create_check_in_followup', {
    parent_response_id: parentResponseId, question, answers, concerning_answers: concerningAnswers,
  })) as string;
}

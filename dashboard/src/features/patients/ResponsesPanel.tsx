import { useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useData } from '@/hooks/useData';
import { Card, Empty, Spinner, ErrorBox, Badge } from '@/components/ui';
import { listEvents } from '@/features/care-events/activity';
import { EventRow } from '@/features/care-events/EventRow';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';
import { addDays, formatDateKey, todayIn } from '@/utils/dates';
import type { CareEvent, EventType } from '@/types/db';

const DAYS = 14;

/** Recent responses, medicine adherence, and meal responses for one patient. */
export function ResponsesPanel({ patientId }: { patientId: string }) {
  const { tz } = useCaregiver();
  const today = todayIn(tz);
  const from = addDays(today, -(DAYS - 1));
  const [openId, setOpenId] = useState<string | null>(null);
  const events = useData(() => listEvents({ from, to: today, patientId }), [from, today, patientId], ['care_events']);

  const all = events.data ?? [];
  const responded = all.filter((e) => e.response_data?.response && e.event_type !== 'TASK')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));

  return (
    <>
      <ErrorBox error={events.error} />
      {events.loading ? <Spinner /> : (
        <div className="grid-2">
          <AdherenceCard title="💊 Medicine adherence" type="MEDICINE" events={all} days={days} yes="Taken" no="Not taken" />
          <AdherenceCard title="🍽️ Meal responses" type="MEAL" events={all} days={days} yes="Eaten" no="Not eaten" />
          <Card title="Recent responses" actions={<span className="muted small">Last {DAYS} days</span>}>
            {responded.length === 0 ? <Empty>No responses yet.</Empty> : (
              <ul className="event-list">{responded.slice(0, 12).map((e) => <EventRow key={e.id} event={e} onOpen={setOpenId} showPatient={false} showDate />)}</ul>
            )}
          </Card>
        </div>
      )}
      {openId && <EventDetailsModal eventId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function AdherenceCard({ title, type, events, days, yes, no }: {
  title: string; type: EventType; events: CareEvent[]; days: string[]; yes: string; no: string;
}) {
  const ev = events.filter((e) => e.event_type === type);
  const counts = {
    yes: ev.filter((e) => e.response_data?.response === 'YES').length,
    no: ev.filter((e) => e.response_data?.response === 'NO').length,
    missed: ev.filter((e) => e.status === 'MISSED').length,
    pending: ev.filter((e) => e.status === 'SCHEDULED' || e.status === 'PENDING').length,
  };
  const answered = counts.yes + counts.no + counts.missed;
  const rate = answered ? Math.round((100 * counts.yes) / answered) : null;

  return (
    <Card title={title} actions={rate != null && <Badge tone={rate >= 80 ? 'success' : rate >= 50 ? 'warning' : 'danger'}>{rate}% {yes.toLowerCase()}</Badge>}>
      {ev.length === 0 ? <Empty>Nothing scheduled in the last {days.length} days.</Empty> : (
        <>
          <div className="adherence-legend small">
            <span><i className="sq sq-yes" /> {yes} {counts.yes}</span>
            <span><i className="sq sq-no" /> {no} {counts.no}</span>
            <span><i className="sq sq-missed" /> Missed {counts.missed}</span>
            <span><i className="sq sq-pending" /> Pending {counts.pending}</span>
          </div>
          <div className="adherence-grid" role="img" aria-label={`${title}: ${counts.yes} ${yes}, ${counts.no} ${no}, ${counts.missed} missed`}>
            {days.map((d) => {
              const dayEv = ev.filter((e) => e.scheduled_date === d).sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
              return (
                <div key={d} className="adherence-day">
                  <div className="adherence-cells">
                    {dayEv.map((e) => {
                      const cls = e.response_data?.response === 'YES' ? 'yes' : e.response_data?.response === 'NO' ? 'no' : e.status === 'MISSED' ? 'missed' : 'pending';
                      return <i key={e.id} className={`sq sq-${cls}`} title={`${formatDateKey(d)} ${e.scheduled_time.slice(0, 5)} · ${e.title} · ${cls}`} />;
                    })}
                  </div>
                  <span className="adherence-label">{formatDateKey(d, { day: 'numeric' })}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}


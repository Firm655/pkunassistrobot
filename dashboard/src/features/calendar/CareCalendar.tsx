import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg, EventContentArg } from '@fullcalendar/core';
import type { DateClickArg } from '@fullcalendar/interaction';
import { useData } from '@/hooks/useData';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { ErrorBox, EventTypeIcon } from '@/components/ui';
import { EVENT_STATUSES, EVENT_TYPES, EVENT_TYPE_META, STATUS_META } from '@/lib/constants';
import { eventTitle } from '@/utils/format';
import { addDays } from '@/utils/dates';
import type { CareEvent, EventStatus, EventType } from '@/types/db';
import { listEvents } from '@/features/care-events/activity';
import { ActivityFormModal } from '@/features/care-events/ActivityForm';
import { EventDetailsModal } from '@/features/care-events/EventDetailsModal';

const STATUS_ICON: Record<EventStatus, string> = {
  SCHEDULED: '', PENDING: '⏳', COMPLETED: '✓', MISSED: '✗', ALERT: '⚠', SKIPPED: '⤼',
};

/**
 * Month/week/day calendar of care events. When `patientId` is given it shows a single
 * patient's schedule; otherwise all patients with a patient filter.
 * Event times are org-local wall-clock values rendered as-is (no timezone conversion).
 */
export function CareCalendar({ patientId, height = 'auto' }: { patientId?: string; height?: string | number }) {
  const { patients, patientMap } = useReferenceData();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [patientFilter, setPatientFilter] = useState(params.get('patient') ?? '');
  const [types, setTypes] = useState<EventType[]>([]);
  const [statuses, setStatuses] = useState<EventStatus[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [createFor, setCreateFor] = useState<{ date: string; time?: string } | null>(null);
  const openEventId = params.get('event');

  const effectivePatient = patientId ?? (patientFilter || undefined);

  const { data, error } = useData(
    () => (range ? listEvents({ ...range, patientId: effectivePatient, types, statuses, includeSkipped: showSkipped }) : Promise.resolve([])),
    [range?.from, range?.to, effectivePatient, types.join(), statuses.join(), showSkipped],
    ['care_events'],
  );

  const fcEvents = useMemo(() => (data ?? []).map((e: CareEvent) => {
    const meta = EVENT_TYPE_META[e.event_type];
    return {
      id: e.id,
      title: eventTitle(e),
      start: `${e.scheduled_date}T${e.scheduled_time}`,
      backgroundColor: meta.color,
      borderColor: meta.color,
      classNames: [`ev-status-${e.status.toLowerCase()}`],
      extendedProps: { event: e },
    };
  }), [data]);

  const openEvent = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('event', id); else next.delete('event');
    setParams(next, { replace: true });
  };

  const onDatesSet = (arg: DatesSetArg) => {
    const from = arg.startStr.slice(0, 10);
    // FullCalendar's end is exclusive
    const to = addDays(arg.endStr.slice(0, 10), -1);
    setRange((r) => (r && r.from === from && r.to === to ? r : { from, to }));
  };

  const renderEvent = (arg: EventContentArg) => {
    const e = arg.event.extendedProps.event as CareEvent;
    const patient = patientMap.get(e.patient_id);
    const isList = arg.view.type.startsWith('list');
    return (
      <div className={`ev ${isList ? 'ev-list' : ''}`} title={`${EVENT_TYPE_META[e.event_type].label} · ${STATUS_META[e.status].label}${patient ? ` · ${patient.name}` : ''}`}>
        <span className="ev-time">{arg.timeText}</span>
        <span className="ev-icon" aria-hidden><EventTypeIcon type={e.event_type} /></span>
        <span className="ev-title">
          {!patientId && patient && <strong className="ev-patient">{patient.name.split(' ')[0]}: </strong>}
          {arg.event.title}
        </span>
        {STATUS_ICON[e.status] && <span className="ev-status" aria-label={STATUS_META[e.status].label}>{STATUS_ICON[e.status]}</span>}
      </div>
    );
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="calendar-wrap">
      <div className="filters">
        {!patientId && (
          <select value={patientFilter} onChange={(e) => setPatientFilter(e.target.value)} aria-label="Filter by patient">
            <option value="">All patients</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="chip-group" aria-label="Filter by event type">
          {EVENT_TYPES.map((t) => (
            <button key={t} type="button" className={`chip ${types.includes(t) ? 'on' : ''}`} style={{ ['--chip' as string]: EVENT_TYPE_META[t].color }} onClick={() => setTypes((l) => toggle(l, t))}>
              <span className="chip-dot" /> {EVENT_TYPE_META[t].short}
            </button>
          ))}
        </div>
        <div className="chip-group" aria-label="Filter by status">
          {EVENT_STATUSES.filter((s) => s !== 'SKIPPED').map((s) => (
            <button key={s} type="button" className={`chip chip-status ${statuses.includes(s) ? 'on' : ''}`} onClick={() => setStatuses((l) => toggle(l, s))}>
              {STATUS_ICON[s] || '•'} {STATUS_META[s].label}
            </button>
          ))}
          <label className="chip chip-check">
            <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} /> Show skipped
          </label>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreateFor({ date: '' })}>+ New event</button>
      </div>
      <ErrorBox error={error} />
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView={patientId ? 'timeGridWeek' : 'dayGridMonth'}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
        buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'List' }}
        firstDay={1}
        height={height}
        nowIndicator
        dayMaxEvents={4}
        slotMinTime="05:00:00"
        slotMaxTime="23:00:00"
        scrollTime="07:00:00"
        defaultTimedEventDuration="01:00"
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        events={fcEvents}
        eventContent={renderEvent}
        datesSet={onDatesSet}
        eventClick={(arg: EventClickArg) => openEvent(arg.event.id)}
        dateClick={(arg: DateClickArg) => setCreateFor({
          date: arg.dateStr.slice(0, 10),
          time: arg.allDay ? undefined : arg.dateStr.slice(11, 16),
        })}
      />
      <div className="legend">
        {EVENT_TYPES.map((t) => <span key={t}><span className="chip-dot" style={{ background: EVENT_TYPE_META[t].color }} /> {EVENT_TYPE_META[t].label}</span>)}
        <span className="legend-sep" />
        {(['PENDING', 'COMPLETED', 'MISSED', 'ALERT'] as EventStatus[]).map((s) => <span key={s}>{STATUS_ICON[s]} {STATUS_META[s].label}</span>)}
      </div>

      {createFor && (
        <ActivityFormModal
          mode={{
            kind: 'create',
            lockPatient: !!patientId,
            initial: { ...(createFor.date ? { date: createFor.date } : {}), ...(createFor.time ? { time: createFor.time } : {}), patient_id: effectivePatient ?? '' },
          }}
          onClose={() => setCreateFor(null)}
        />
      )}
      {openEventId && <EventDetailsModal eventId={openEventId} onClose={() => openEvent(null)} />}
    </div>
  );
}

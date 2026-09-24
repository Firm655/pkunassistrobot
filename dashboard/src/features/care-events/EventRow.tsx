import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { EventTypeTag, StatusBadge, PatientAvatar } from '@/components/ui';
import { eventTitle, responseSummary } from '@/utils/format';
import { formatDateKey, hhmm } from '@/utils/dates';
import type { CareEvent } from '@/types/db';

export function EventRow({ event: e, onOpen, showPatient = true, showDate = false }: {
  event: CareEvent; onOpen: (id: string) => void; showPatient?: boolean; showDate?: boolean;
}) {
  const { patientMap } = useReferenceData();
  const patient = patientMap.get(e.patient_id);
  const resp = responseSummary(e);
  return (
    <li>
      <button className="event-row" onClick={() => onOpen(e.id)}>
        <span className="event-time">
          {showDate && <span className="muted small">{formatDateKey(e.scheduled_date, { day: 'numeric', month: 'short' })}</span>}
          {hhmm(e.scheduled_time)}
        </span>
        <EventTypeTag type={e.event_type} short />
        <span className="event-main">
          <span className="event-title">{eventTitle(e)}</span>
          {showPatient && patient && (
            <span className="event-patient"><PatientAvatar patient={patient} size={18} /> {patient.name}</span>
          )}
        </span>
        {resp && <span className="event-resp">{resp}</span>}
        <StatusBadge status={e.status} />
      </button>
    </li>
  );
}

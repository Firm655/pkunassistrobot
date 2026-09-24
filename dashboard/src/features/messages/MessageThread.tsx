import { useEffect, useRef } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Spinner, ErrorBox, Empty } from '@/components/ui';
import { formatDateTime } from '@/utils/dates';
import { listMessages } from './api';
import type { Message } from '@/types/db';

export function PatientResponses({ patientId }: { patientId: string }) {
  const { tz } = useCaregiver();
  const { patientMap } = useReferenceData();
  const { data, loading, error } = useData(() => listMessages({ patientId, limit: 100, patientResponsesOnly: true }), [patientId], ['messages']);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = [...(data ?? [])].reverse();
  const patient = patientMap.get(patientId);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  return (
    <div className="responses-thread">
      <div className="thread-messages">
        {loading ? <Spinner label="Loading patient responses…" /> : messages.length === 0 ? <Empty>No patient responses yet.</Empty> : messages.map((m) => (
          <Bubble key={m.id} m={m} tz={tz} sender={patient?.name ?? 'Patient'} />
        ))}
        <div ref={endRef} />
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Bubble({ m, tz, sender }: { m: Message; tz: string; sender: string }) {
  const urgent = m.request_code === 'HELP' || m.request_code === 'NOT_RIGHT';
  return (
    <div className="bubble-row theirs">
      <div className={`bubble ${urgent ? 'bubble-urgent' : ''}`}>
        <div className="bubble-kicker">{urgent ? '🚨 ' : ''}{m.message_type === 'PATIENT_REQUEST' ? 'Patient request' : 'Patient response'}</div>
        <div>{m.message}</div>
        <div className="bubble-meta">
          {sender} · {formatDateTime(m.created_at, tz)}
        </div>
      </div>
    </div>
  );
}

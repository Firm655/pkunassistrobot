import { useEffect, useRef, useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { Spinner, ErrorBox, Empty, Badge } from '@/components/ui';
import { CAREGIVER_PRESET_MESSAGES } from '@/lib/constants';
import { formatDateTime } from '@/utils/dates';
import { listMessages, sendCaregiverMessage } from './api';
import type { Message } from '@/types/db';

const MAX_CUSTOM = 300;

export function MessageThread({ patientId }: { patientId: string }) {
  const { tz } = useCaregiver();
  const { profileMap, patientMap, deviceByPatient } = useReferenceData();
  const { data, loading, error } = useData(() => listMessages({ patientId, limit: 100 }), [patientId], ['messages']);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = [...(data ?? [])].reverse();
  const patient = patientMap.get(patientId);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  const send = async (message: string, type: 'PRESET' | 'CUSTOM') => {
    if (!message.trim()) return;
    setBusy(true); setSendError(null);
    try { await sendCaregiverMessage(patientId, message.trim(), type); if (type === 'CUSTOM') setText(''); }
    catch (e) { setSendError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="thread">
      {!deviceByPatient.get(patientId) && (
        <p className="note">{patient?.name ?? 'This patient'} has no P-kun assigned. Messages will be stored and delivered once a device is assigned.</p>
      )}
      <div className="thread-messages">
        {loading ? <Spinner /> : messages.length === 0 ? <Empty>No messages yet.</Empty> : messages.map((m) => (
          <Bubble key={m.id} m={m} tz={tz} sender={m.sender_type === 'CARETAKER' ? profileMap.get(m.sender_id)?.full_name ?? 'Caretaker' : patient?.name ?? 'Patient'} />
        ))}
        <div ref={endRef} />
      </div>
      <ErrorBox error={error || sendError} />
      <div className="presets">
        {CAREGIVER_PRESET_MESSAGES.map((p) => (
          <button key={p} className="chip" disabled={busy} onClick={() => send(p, 'PRESET')}>{p}</button>
        ))}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text, 'CUSTOM'); }}>
        <input value={text} maxLength={MAX_CUSTOM} placeholder="Write a short message…" onChange={(e) => setText(e.target.value)} />
        <span className="muted small">{text.length}/{MAX_CUSTOM}</span>
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

function Bubble({ m, tz, sender }: { m: Message; tz: string; sender: string }) {
  const mine = m.sender_type === 'CARETAKER';
  const urgent = m.request_code === 'HELP' || m.request_code === 'NOT_RIGHT';
  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className={`bubble ${urgent ? 'bubble-urgent' : ''}`}>
        {m.message_type === 'PATIENT_REQUEST' && <div className="bubble-kicker">{urgent ? '🚨 ' : ''}Patient request</div>}
        <div>{m.message}</div>
        <div className="bubble-meta">
          {sender} · {formatDateTime(m.created_at, tz)}
          {mine && (
            m.acknowledged_at ? <Badge tone="success">✓✓ Acknowledged {formatDateTime(m.acknowledged_at, tz)}</Badge>
              : m.delivered_at ? <Badge tone="info">✓ Delivered</Badge>
                : <Badge tone="muted">Sent</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

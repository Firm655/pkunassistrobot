import { useSearchParams } from 'react-router-dom';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { PageHeader, Card, PatientAvatar, Empty } from '@/components/ui';
import { MessageThread } from '@/features/messages/MessageThread';
import { listMessages } from '@/features/messages/api';
import { timeAgo } from '@/utils/dates';

export default function MessagesPage() {
  const { patients } = useReferenceData();
  const [params, setParams] = useSearchParams();
  const selected = params.get('patient') ?? '';
  const recent = useData(() => listMessages({ limit: 300 }), [], ['messages']);
  const active = patients.filter((p) => p.status === 'ACTIVE');
  const last = (id: string) => recent.data?.find((m) => m.patient_id === id);
  const sorted = [...active].sort((a, b) => (last(b.id)?.created_at ?? '').localeCompare(last(a.id)?.created_at ?? ''));

  return (
    <>
      <PageHeader title="Messages" subtitle="Send preset or short custom messages to a patient's P-kun and see patient requests." />
      <div className="messages-layout">
        <Card pad={false} className="patient-picker">
          {sorted.length === 0 ? <div className="card-body"><Empty>No active patients.</Empty></div> : (
            <ul className="picker-list">
              {sorted.map((p) => {
                const m = last(p.id);
                const needsAttention = m?.sender_type === 'PATIENT';
                return (
                  <li key={p.id}>
                    <button className={`picker-item ${selected === p.id ? 'active' : ''}`} onClick={() => setParams({ patient: p.id })}>
                      <PatientAvatar patient={p} size={36} />
                      <span className="grow">
                        <strong>{p.name}</strong>
                        <span className="muted small ellipsis">{m ? `${m.sender_type === 'PATIENT' ? '🙋 ' : ''}${m.message}` : 'No messages'}</span>
                      </span>
                      {m && <span className={`small ${needsAttention ? 'text-danger' : 'muted'}`}>{timeAgo(m.created_at)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title={selected ? patients.find((p) => p.id === selected)?.name : 'Select a patient'}>
          {selected ? <MessageThread patientId={selected} /> : <Empty>Choose a patient on the left to view and send messages.</Empty>}
        </Card>
      </div>
    </>
  );
}

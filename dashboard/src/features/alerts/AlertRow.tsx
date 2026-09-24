import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useCaregiver } from '@/contexts/AuthContext';
import { useReferenceData } from '@/contexts/ReferenceDataContext';
import { PriorityBadge, Badge } from '@/components/ui';
import { ALERT_TYPE_LABEL } from '@/lib/constants';
import { formatDateTime, timeAgo } from '@/utils/dates';
import type { Alert } from '@/types/db';
import { reviewAlert } from './api';

export function AlertRow({ alert: a, onOpenEvent, compact, onReviewed }: { alert: Alert; onOpenEvent?: (id: string) => void; compact?: boolean; onReviewed?: () => void }) {
  const { tz } = useCaregiver();
  const { patientMap, profileMap } = useReferenceData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const patient = a.patient_id ? patientMap.get(a.patient_id) : undefined;
  const review = async () => {
    setBusy(true);
    try { await reviewAlert(a.id); setErr(null); onReviewed?.(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className={`alert-row prio-${a.priority.toLowerCase()} ${a.reviewed ? 'reviewed' : ''}`}>
      <PriorityBadge priority={a.priority} />
      <div className="grow">
        <div className="alert-title">
          <strong>{ALERT_TYPE_LABEL[a.alert_type]}</strong>
          {patient && <> · <Link to={`/patients/${patient.id}`}>{patient.name}</Link></>}
        </div>
        <div className="muted small">
          {a.message} · <span title={formatDateTime(a.created_at, tz)}>{timeAgo(a.created_at)}</span>
          {a.reviewed && a.reviewed_by && <> · reviewed by {profileMap.get(a.reviewed_by)?.full_name ?? 'staff'} {formatDateTime(a.reviewed_at, tz)}</>}
        </div>
        {err && <div className="error-text small">{err}</div>}
      </div>
      {!compact && a.event_id && onOpenEvent && <button className="btn btn-sm btn-ghost" onClick={() => onOpenEvent(a.event_id!)}>Open event</button>}
      {a.reviewed ? <Badge tone="success">Reviewed</Badge> : <button className="btn btn-sm" onClick={review} disabled={busy}>Mark reviewed</button>}
    </li>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { EVENT_TYPE_META, PRIORITY_META, STATUS_META, type Tone } from '@/lib/constants';
import type { EventStatus, EventType, Patient, Priority } from '@/types/db';
import { initials } from '@/utils/format';
import { signedPhotoUrl } from '@/features/patients/api';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function StatusBadge({ status }: { status: EventStatus }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const m = PRIORITY_META[priority];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function EventTypeTag({ type, short }: { type: EventType; short?: boolean }) {
  const m = EVENT_TYPE_META[type];
  return (
    <span className="type-tag" style={{ ['--tag' as string]: m.color }}>
      <span aria-hidden>{m.icon}</span> {short ? m.short : m.label}
    </span>
  );
}

export function Card({ title, actions, children, className = '', pad = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="spinner-wrap"><span className="spinner" aria-hidden /> {label}</div>;
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="error-box" role="alert">{error}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, full }: { label: string; children: ReactNode; hint?: string; full?: boolean }) {
  return (
    <label className={`field ${full ? 'field-full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PatientAvatar({ patient, size = 40 }: { patient: Pick<Patient, 'name' | 'profile_photo'> | undefined; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (patient?.profile_photo) signedPhotoUrl(patient.profile_photo).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [patient?.profile_photo]);
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (url) return <img className="avatar" src={url} alt="" style={style} />;
  return <span className="avatar avatar-fallback" style={style} aria-hidden>{patient ? initials(patient.name) : '?'}</span>;
}

export function Stat({ label, value, tone, onClick }: { label: string; value: ReactNode; tone?: Tone; onClick?: () => void }) {
  return (
    <button type="button" className={`stat stat-${tone ?? 'neutral'}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}

export function DeviceStatusDot({ status }: { status: 'ONLINE' | 'OFFLINE' | 'PAIRING' }) {
  const tone = status === 'ONLINE' ? 'success' : status === 'PAIRING' ? 'info' : 'danger';
  return <Badge tone={tone}><span className={`dot dot-${tone}`} /> {status === 'ONLINE' ? 'Online' : status === 'PAIRING' ? 'Pairing' : 'Offline'}</Badge>;
}

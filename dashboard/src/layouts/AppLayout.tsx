import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuth, useCaregiver } from '@/contexts/AuthContext';
import { RealtimeProvider, useRealtime } from '@/contexts/RealtimeContext';
import { ReferenceDataProvider } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { supabase } from '@/lib/supabase';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/patients', label: 'Patients', icon: '👥' },
  { to: '/check-ins', label: 'Daily check-in', icon: '☑' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/alerts', label: 'Alerts', icon: '🔔', badge: true },
  { to: '/history', label: 'History', icon: '🕘' },
];
const NAV_SECONDARY = [
  { to: '/devices', label: 'P-kun devices', icon: '🤖' },
  { to: '/settings', label: 'Team & settings', icon: '⚙️' },
];

function UnreviewedCount() {
  const { data } = useData(async () => {
    const { count, error } = await supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('reviewed', false);
    if (error) throw error;
    return count ?? 0;
  }, [], ['alerts']);
  if (!data) return null;
  return <span className="nav-badge">{data > 99 ? '99+' : data}</span>;
}

function ConnectionPill() {
  const { connected } = useRealtime();
  return (
    <span className={`conn ${connected ? 'on' : 'off'}`} title={connected ? 'Receiving live updates' : 'Live updates reconnecting…'}>
      <span className="dot" /> {connected ? 'Live' : 'Offline'}
    </span>
  );
}

function Shell() {
  const { signOut } = useAuth();
  const { profile, organization } = useCaregiver();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="currentColor" /><circle cx="12" cy="14" r="2.5" fill="#fff" /><circle cx="20" cy="14" r="2.5" fill="#fff" /><path d="M11 20c2.5 2.5 7.5 2.5 10 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          </span>
          <div>
            <strong>P-kun Care</strong>
            <div className="brand-org">{organization.name}</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={close} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
              {n.badge && <UnreviewedCount />}
            </NavLink>
          ))}
          <div className="nav-sep" />
          {NAV_SECONDARY.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={close} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <strong>{profile.full_name}</strong>
            <span className="muted">{profile.role === 'admin' ? 'Administrator' : 'Caretaker'}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>Log out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
          <div className="topbar-spacer" />
          <ConnectionPill />
        </header>
        <main className="content"><Outlet /></main>
      </div>
      {open && <div className="nav-scrim" onClick={close} />}
    </div>
  );
}

export default function AppLayout() {
  const { orgId } = useCaregiver();
  return (
    <RealtimeProvider orgId={orgId}>
      <ReferenceDataProvider>
        <Shell />
      </ReferenceDataProvider>
    </RealtimeProvider>
  );
}

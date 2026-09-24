import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, LogOut, Menu, Settings, X } from 'lucide-react';
import { useAuth, useCaregiver } from '@/contexts/AuthContext';
import { RealtimeProvider, useRealtime } from '@/contexts/RealtimeContext';
import { ReferenceDataProvider } from '@/contexts/ReferenceDataContext';
import { useData } from '@/hooks/useData';
import { supabase } from '@/lib/supabase';
import { initials } from '@/utils/format';

const navigation = [
  { to: '/', label: 'My day', end: true },
  { to: '/patients', label: 'Patients' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/check-ins', label: 'Check-ins' },
  { to: '/alerts', label: 'Alerts', badge: true },
  { to: '/history', label: 'History' },
];

function AlertCount() {
  const { data } = useData(async () => {
    const { count, error } = await supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('reviewed', false);
    if (error) throw error;
    return count ?? 0;
  }, [], ['alerts']);
  return data ? <span className="navigation-count">{data > 99 ? '99+' : data}</span> : null;
}

function Shell() {
  const { signOut } = useAuth();
  const { profile, organization } = useCaregiver();
  const { connected } = useRealtime();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenuOpen(false); setAccountOpen(false); }, [location.pathname]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!account.current?.contains(e.target as Node)) setAccountOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <div className="clinic-app" onKeyDown={(e) => {
    if (e.key === 'Escape') {
      if (menuOpen) menuButton.current?.focus();
      if (accountOpen) account.current?.querySelector('button')?.focus();
      setMenuOpen(false); setAccountOpen(false);
    }
  }}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="clinic-header">
      <div className="clinic-identity">
        <Link to="/" className="clinic-brand" aria-label="P-kun Care home"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="30" height="30" /><strong>P-kun<span>care</span></strong></Link>
        <span className="clinic-organization">{organization.name}</span>
      </div>
      <div className="clinic-account-tools">
        <span className={`sync-state ${connected ? 'connected' : ''}`} title={connected ? 'Receiving live updates' : 'Live connection is reconnecting'}><span className="dot" />{connected ? 'Live updates' : 'Reconnecting'}</span>
        <div className="account-dropdown" ref={account}>
          <button className="account-trigger" aria-expanded={accountOpen} aria-controls="account-options" onClick={() => setAccountOpen(!accountOpen)}><span className="staff-avatar">{initials(profile.full_name)}</span><span className="staff-name">{profile.full_name}</span><ChevronDown size={14} /></button>
          {accountOpen && <div id="account-options" className="account-options"><p>{profile.role === 'admin' ? 'Administrator' : 'Caregiver'}</p><Link to="/settings"><Settings size={16} /> Team & settings</Link><button onClick={signOut}><LogOut size={16} /> Sign out</button></div>}
        </div>
        <button ref={menuButton} className="icon-btn clinic-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="clinic-navigation">{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
    </header>
    <nav id="clinic-navigation" aria-label="Main navigation" className={`clinic-navigation ${menuOpen ? 'is-open' : ''}`}>
      <div className="clinic-primary-nav">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'selected' : ''}>{item.label}{item.badge && <AlertCount />}</NavLink>)}</div>
      <div className="clinic-secondary-nav"><NavLink to="/devices"><Bot size={17} /> Devices</NavLink><NavLink to="/settings"><Settings size={17} /> Settings</NavLink></div>
    </nav>
    <main id="main-content" tabIndex={-1} className={`clinic-content ${location.pathname === '/' ? 'is-day-view' : ''}`}><Outlet /></main>
    <footer className="clinic-footer"><span>P-kun Care</span><span>{organization.timezone}</span></footer>
  </div>;
}

export default function AppLayout() {
  const { orgId } = useCaregiver();
  return <RealtimeProvider orgId={orgId}><ReferenceDataProvider><Shell /></ReferenceDataProvider></RealtimeProvider>;
}

import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseConfigured } from '@/lib/supabase';
import { ErrorBox } from '@/components/ui';

export default function LoginPage() {
  const { state, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'ready' || state.status === 'not-provisioned') return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signIn(email.trim(), password); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <svg viewBox="0 0 32 32" width="44" height="44"><rect width="32" height="32" rx="8" fill="var(--primary)" /><circle cx="12" cy="14" r="2.5" fill="#fff" /><circle cx="20" cy="14" r="2.5" fill="#fff" /><path d="M11 20c2.5 2.5 7.5 2.5 10 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          <div>
            <h1>P-kun Care</h1>
            <p className="muted">Caregiver dashboard</p>
          </div>
        </div>
        {!supabaseConfigured && (
          <ErrorBox error="Supabase is not configured. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY." />
        )}
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">First time here? <Link to="/register">Create an account</Link> with the team code from your administrator.</p>
      </form>
    </div>
  );
}

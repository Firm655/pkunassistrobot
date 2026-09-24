import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseConfigured } from '@/lib/supabase';
import { ErrorBox } from '@/components/ui';
import { registerCaregiver } from '@/features/team/api';

/** First-time caregivers create their account with a team code from their administrator. */
export default function RegisterPage() {
  const { state, signIn } = useAuth();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '', team_code: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'ready' || state.status === 'not-provisioned') return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  // Format as XXXX-XXXX while typing; ignore characters that can't be in a code.
  const onCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setForm({ ...form, team_code: raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');
    if (form.team_code.replace('-', '').length !== 8) return setError('The team code has 8 characters, e.g. K7QM-4TZP.');
    setBusy(true);
    try {
      const email = form.email.trim();
      await registerCaregiver({ full_name: form.full_name.trim(), email, password: form.password, team_code: form.team_code });
      await signIn(email, form.password); // lands on the dashboard via the auth state change
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <svg viewBox="0 0 32 32" width="44" height="44"><rect width="32" height="32" rx="8" fill="var(--primary)" /><circle cx="12" cy="14" r="2.5" fill="#fff" /><circle cx="20" cy="14" r="2.5" fill="#fff" /><path d="M11 20c2.5 2.5 7.5 2.5 10 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          <div>
            <h1>Create your account</h1>
            <p className="muted">For caregivers joining a P-kun care team</p>
          </div>
        </div>
        {!supabaseConfigured && (
          <ErrorBox error="Supabase is not configured. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY." />
        )}
        <label className="field">
          <span className="field-label">Team code</span>
          <input className="team-code-input" value={form.team_code} onChange={onCode} placeholder="K7QM-4TZP" autoComplete="off" spellCheck={false} required />
          <span className="field-hint">Ask your administrator. It's shown on their Team &amp; settings page.</span>
        </label>
        <label className="field">
          <span className="field-label">Full name</span>
          <input value={form.full_name} onChange={set('full_name')} autoComplete="name" maxLength={120} required />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} maxLength={72} required />
          <span className="field-hint">At least 8 characters.</span>
        </label>
        <label className="field">
          <span className="field-label">Confirm password</span>
          <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="muted small">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}

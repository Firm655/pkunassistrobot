import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Organization, Profile } from '@/types/db';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'not-provisioned'; session: Session }
  | { status: 'error'; session: Session; message: string }
  | { status: 'ready'; session: Session; profile: Profile; organization: Organization };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async (s: Session) => {
    // A Supabase Auth user is only a caregiver if a profile was explicitly provisioned.
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error) return setState({ status: 'error', session: s, message: error.message });
    if (!profile) return setState({ status: 'not-provisioned', session: s });
    const { data: org, error: orgErr } = await supabase
      .from('organizations').select('*').eq('id', profile.organization_id).single();
    if (orgErr) return setState({ status: 'error', session: s, message: orgErr.message });
    setState({
      status: 'ready', session: s, profile: profile as Profile,
      organization: { ...(org as Organization), timezone: (org as Organization).timezone || DEFAULT_TIMEZONE },
    });
  }, []);

  // Only reload the profile when the signed-in user changes (not on every token refresh).
  const userId = session?.user.id;
  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setState({ status: 'signed-out' }); return; }
    setState((prev) => (prev.status === 'ready' && prev.session.user.id === session.user.id ? { ...prev, session } : { status: 'loading' }));
    loadProfile(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session === null]);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    signOut: async () => {
      await supabase.removeAllChannels();
      await supabase.auth.signOut();
    },
    reloadProfile: async () => { if (session) await loadProfile(session); },
  }), [state, session, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For pages rendered behind <RequireAuth>: guaranteed signed-in caregiver. */
export function useCaregiver() {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useCaregiver used outside a ready session');
  return {
    profile: state.profile,
    organization: state.organization,
    orgId: state.organization.id,
    tz: state.organization.timezone,
    isAdmin: state.profile.role === 'admin',
    userId: state.session.user.id,
  };
}

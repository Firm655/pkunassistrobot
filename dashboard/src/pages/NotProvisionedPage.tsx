import { useAuth } from '@/contexts/AuthContext';

export default function NotProvisionedPage() {
  const { state, signOut, reloadProfile } = useAuth();
  const user = state.status === 'not-provisioned' || state.status === 'error' ? state.session.user : null;
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{state.status === 'error' ? 'Could not load your profile' : 'Access not provisioned'}</h1>
        {state.status === 'error' ? (
          <p className="error-box">{state.message}</p>
        ) : (
          <p>
            You are signed in as <strong>{user?.email}</strong>, but this account has no caregiver profile.
            Ask an administrator to provision it (Team &amp; settings → Add caregiver) using your user ID:
          </p>
        )}
        {user && <code className="code-block">{user.id}</code>}
        <div className="row gap">
          <button className="btn" onClick={reloadProfile}>Try again</button>
          <button className="btn btn-ghost" onClick={signOut}>Log out</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api, clearStoredApiKey, getStoredApiKey, setStoredApiKey } from '../api/client';

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'That sign-in link expired or was invalid — try again.',
  not_configured: 'Google sign-in is not configured.',
  token_exchange_failed: 'Google sign-in failed — please try again.',
  token_verification_failed: 'Google sign-in failed — please try again.',
  audience_mismatch: 'Google sign-in failed — please try again.',
  email_not_verified: "That Google account's email isn't verified.",
  not_allowed: "That Google account isn't allowed to sign in here.",
};

// The web UI is username/password-first. The server still uses an API key as
// its internal bearer credential so scripts and integrations remain compatible,
// New browser users never need to find or copy that key themselves. Existing
// API-key-only installations can still enter it once to migrate safely.
export default function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [localLoginConfigured, setLocalLoginConfigured] = useState<boolean | null>(null);
  const [localSetupAllowed, setLocalSetupAllowed] = useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  async function tryKey(key: string) {
    setStoredApiKey(key);
    try {
      const res = await fetch('/api/v1/artist', { headers: { 'X-Api-Key': key } });
      if (res.ok) {
        setAuthorized(true);
        setError(null);
        return true;
      }
      setError('Incorrect API key.');
    } catch {
      setError('Could not reach the server.');
    }

    clearStoredApiKey();
    setAuthorized(false);
    return false;
  }

  useEffect(() => {
    let cancelled = false;
    const onUnauthorized = () => {
      clearStoredApiKey();
      setAuthorized(false);
      setError('Your session ended. Sign in again.');
    };
    window.addEventListener('vidarr:unauthorized', onUnauthorized);

    async function initialize() {
      // Both status checks are best-effort: a transient failure on either
      // one must not block a returning user whose already-stored API key is
      // still perfectly valid — that's checked independently below via
      // getStoredApiKey()/tryKey() regardless of what these report. Without
      // this fallback, a momentary hiccup on just the login-status endpoint
      // would reject the whole Promise.all and land on the "Vidarr is
      // unavailable" screen even for someone who didn't need it to succeed.
      const [googleStatus, loginStatus] = await Promise.all([
        api.googleAuth.status().catch(() => ({ configured: false })),
        api.localAuth.status().catch(() => ({ configured: false, setupAllowed: false })),
      ]);
      if (cancelled) return;
      setGoogleConfigured(googleStatus.configured);
      setLocalLoginConfigured(loginStatus.configured);
      setLocalSetupAllowed(loginStatus.setupAllowed);

      const params = new URLSearchParams(window.location.search);
      const exchangeToken = params.get('google_exchange');
      const googleError = params.get('google_error');
      if (exchangeToken || googleError) {
        params.delete('google_exchange');
        params.delete('google_error');
        const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '');
        window.history.replaceState(null, '', cleanUrl);
      }

      if (exchangeToken) {
        setChecking(true);
        try {
          const res = await fetch('/api/v1/auth/google/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: exchangeToken }),
          });
          if (!res.ok) throw new Error();
          const body = (await res.json()) as { apiKey: string };
          await tryKey(body.apiKey);
        } catch {
          setAuthorized(false);
          setError('That sign-in link expired or was already used — try signing in again.');
        } finally {
          setChecking(false);
        }
        return;
      }

      if (googleError) {
        setAuthorized(false);
        setError(GOOGLE_ERROR_MESSAGES[googleError] ?? 'Google sign-in failed — please try again.');
        return;
      }

      const stored = getStoredApiKey();
      if (stored) {
        setChecking(true);
        await tryKey(stored);
        setChecking(false);
        return;
      }

      setAuthorized(false);
    }

    initialize().catch(() => {
      setStatusUnavailable(true);
      setAuthorized(false);
      setError('Could not reach the server or check its sign-in status.');
    });

    return () => {
      cancelled = true;
      window.removeEventListener('vidarr:unauthorized', onUnauthorized);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isSetup = !localLoginConfigured && localSetupAllowed;
    const isApiKeyMigration = !localLoginConfigured && !localSetupAllowed;
    if (isApiKeyMigration) {
      if (!apiKeyInput.trim()) return;
      setChecking(true);
      setError(null);
      await tryKey(apiKeyInput.trim());
      setChecking(false);
      return;
    }
    if (!username.trim() || !password) return;
    if (isSetup && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const result = isSetup
        ? await api.localAuth.setup(username.trim(), password)
        : await api.localAuth.login(username.trim(), password);
      if (isSetup) setLocalLoginConfigured(true);
      await tryKey(result.apiKey);
    } catch (err) {
      setAuthorized(false);
      setError(err instanceof Error ? err.message : isSetup ? 'Account setup failed.' : 'Sign-in failed.');
      if (isSetup) {
        try {
          const status = await api.localAuth.status();
          setLocalLoginConfigured(status.configured);
          setLocalSetupAllowed(status.setupAllowed);
        } catch {
          setStatusUnavailable(true);
          setError('Could not reach the server or check its sign-in status.');
        }
      }
    } finally {
      setChecking(false);
    }
  }

  if (authorized) return <>{children}</>;

  if (statusUnavailable) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
        <div className="card" style={{ width: '100%', maxWidth: 420 }}>
          <h2 style={{ marginTop: 0 }}>Vidarr is unavailable</h2>
          <p className="empty-state">{error}</p>
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (authorized === null || checking || localLoginConfigured === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p className="empty-state">Checking…</p>
      </div>
    );
  }

  const isSetup = !localLoginConfigured && localSetupAllowed;
  const isApiKeyMigration = !localLoginConfigured && !localSetupAllowed;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>{isSetup ? 'Welcome to vidarr' : 'Sign in to vidarr'}</h2>
        <p className="empty-state" style={{ padding: '0 0 12px' }}>
          {isSetup
            ? 'Create the owner account for this Vidarr installation.'
            : isApiKeyMigration
              ? 'Enter the existing integration API key once, then create an owner account in Settings.'
              : 'Enter your owner username and password.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {isApiKeyMigration ? (
              <>
                <label htmlFor="login-api-key">Integration API key</label>
                <input
                  id="login-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  autoFocus
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  required
                />
                <label htmlFor="login-password">Password{isSetup ? ' (min. 8 characters)' : ''}</label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete={isSetup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={isSetup ? 8 : undefined}
                  required
                />
                {isSetup && (
                  <>
                    <label htmlFor="login-password-confirm">Confirm password</label>
                    <input
                      id="login-password-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </>
                )}
              </>
            )}
            <button type="submit">{isSetup ? 'Create owner account' : 'Sign in'}</button>
          </div>
        </form>

        {error && (
          <p className="empty-state" role="alert">
            {error}
          </p>
        )}
        {googleConfigured && (
          <>
            <p className="empty-state" style={{ padding: '12px 0 4px', textAlign: 'center' }}>
              or
            </p>
            <button
              type="button"
              className="secondary"
              style={{ width: '100%' }}
              onClick={() => {
                window.location.href = '/api/v1/auth/google/login';
              }}
            >
              Sign in with Google
            </button>
          </>
        )}
      </div>
    </div>
  );
}

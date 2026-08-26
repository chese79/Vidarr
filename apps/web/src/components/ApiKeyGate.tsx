import { useEffect, useState } from 'react';
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from '../api/client';

// Every /api/v1/* route (except /health) now requires vidarr's own API key —
// this gate keeps the app from rendering (and issuing requests that will
// just 401) until a valid key is stored. The key itself is generated on
// first server boot and printed to the server's own logs (see
// apps/server/src/pipeline/auth.ts) — there's no way to fetch it through the
// API before you already have it, same bootstrap problem Sonarr/Radarr solve
// by putting it in config.xml. Once authenticated once, Settings can show/
// rotate it.
export default function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function tryKey(key: string) {
    setStoredApiKey(key);
    try {
      const res = await fetch('/api/v1/artist', { headers: { 'X-Api-Key': key } });
      if (res.ok) {
        setAuthorized(true);
        setError(null);
        return;
      }
      clearStoredApiKey();
      setAuthorized(false);
      setError('Incorrect API key.');
    } catch {
      clearStoredApiKey();
      setAuthorized(false);
      setError('Could not reach the server.');
    }
  }

  useEffect(() => {
    const stored = getStoredApiKey();
    if (stored) {
      setChecking(true);
      tryKey(stored).finally(() => setChecking(false));
    } else {
      setAuthorized(false);
    }

    const onUnauthorized = () => setAuthorized(false);
    window.addEventListener('vidarr:unauthorized', onUnauthorized);
    return () => window.removeEventListener('vidarr:unauthorized', onUnauthorized);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setChecking(true);
    tryKey(input.trim()).finally(() => setChecking(false));
  }

  if (authorized) return <>{children}</>;

  if (authorized === null || checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p className="empty-state">Checking…</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <form className="card" onSubmit={handleSubmit} style={{ minWidth: 360 }}>
        <h2 style={{ marginTop: 0 }}>vidarr</h2>
        <p className="empty-state" style={{ padding: '0 0 12px' }}>
          Enter your API key. It was printed to the server's console log the first time it started
          — check there, or ask whoever set up this instance.
        </p>
        <div className="form-row">
          <input
            type="password"
            placeholder="API key"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ minWidth: 260 }}
            autoFocus
            required
          />
          <button type="submit" disabled={checking}>
            {checking ? 'Checking…' : 'Continue'}
          </button>
        </div>
        {error && <p className="empty-state">{error}</p>}
      </form>
    </div>
  );
}

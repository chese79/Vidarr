import { useEffect, useRef, useState } from 'react';
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from '../api/client';

// Every /api/v1/* route (except /health and /setup/bootstrap-key) requires
// vidarr's own API key — this gate keeps the app from rendering (and
// issuing requests that will just 401) until a valid key is stored. The key
// itself is generated on first server boot; on a fresh install (nobody has
// ever logged in yet), GET /setup/bootstrap-key reveals it once, over HTTP,
// within a short window (see apps/server/src/api/setup.ts) so the first
// screen you see can just show it, instead of sending you to dig through
// server/container logs. After that first login, this route stops working
// permanently — Settings is the only place to view/rotate it from then on.
export default function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [bootstrapKey, setBootstrapKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const keyTextRef = useRef<HTMLSpanElement>(null);

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
      return;
    }

    fetch('/api/v1/setup/bootstrap-key')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { apiKey: string } | null) => {
        if (body?.apiKey) setBootstrapKey(body.apiKey);
        setAuthorized(false);
      })
      .catch(() => setAuthorized(false));

    const onUnauthorized = () => setAuthorized(false);
    window.addEventListener('vidarr:unauthorized', onUnauthorized);
    return () => window.removeEventListener('vidarr:unauthorized', onUnauthorized);
  }, []);

  function acceptBootstrapKey() {
    if (!bootstrapKey) return;
    setChecking(true);
    tryKey(bootstrapKey).finally(() => setChecking(false));
  }

  async function copyBootstrapKey() {
    if (!bootstrapKey) return;
    try {
      await navigator.clipboard.writeText(bootstrapKey);
      setCopied(true);
    } catch {
      // Clipboard API can be blocked (permissions policy, insecure origin,
      // browser-specific restrictions) — fall back to selecting the text so
      // the user can still Ctrl+C/Cmd+C it manually instead of the button
      // silently doing nothing.
      const range = document.createRange();
      if (keyTextRef.current) {
        range.selectNodeContents(keyTextRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyFailed(true);
    }
  }

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

  if (bootstrapKey) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="card" style={{ minWidth: 420, maxWidth: 480 }}>
          <h2 style={{ marginTop: 0 }}>Welcome to vidarr</h2>
          <p style={{ padding: '0 0 12px' }}>Here's your API key — every request needs it.</p>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 12px',
              background: 'var(--color-bg-inset, rgba(127,127,127,0.12))',
              borderRadius: 6,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            <span ref={keyTextRef} style={{ flex: 1 }}>
              {bootstrapKey}
            </span>
            <button type="button" onClick={copyBootstrapKey}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {copyFailed && (
            <p className="empty-state" style={{ padding: '4px 0 0' }}>
              Couldn't copy automatically — the key is selected above, so Ctrl+C / Cmd+C will work.
            </p>
          )}
          <p className="empty-state" style={{ padding: '12px 0 0', fontWeight: 600 }}>
            Copy this now and store it somewhere safe (a password manager). This is the only time
            it will be shown to you like this — it will never appear on this screen again. You can
            still view or rotate it later from Settings, but only once you're already logged in.
          </p>
          <div style={{ paddingTop: 16 }}>
            <button type="button" onClick={acceptBootstrapKey} disabled={checking}>
              {checking ? 'Continuing…' : "I've saved it — continue"}
            </button>
          </div>
          {error && <p className="empty-state">{error}</p>}
        </div>
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

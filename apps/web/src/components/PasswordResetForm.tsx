import { useState } from 'react';
import { api } from '../api/client';

export default function PasswordResetForm({ initialUsername, onComplete, onCancel }: {
  initialUsername: string; onComplete: (username: string) => void; onCancel: () => void;
}) {
  const [key, setKey] = useState(''), [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function reset(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (password !== confirmation) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const result = await api.localAuth.resetPassword(key, username, password);
      setKey(''); setPassword(''); setConfirmation(''); onComplete(result.adminUsername);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not reset the password.'); }
    finally { setBusy(false); }
  }
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
    <div className="card" style={{ width: '100%', maxWidth: 460 }}>
      <h2 style={{ marginTop: 0 }}>Reset owner password</h2>
      <p>Use this installation’s integration API key to prove you own Vidarr, then choose your owner username and new password. Your library, integrations and API key are preserved.</p>
      <form onSubmit={reset}><fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="reset-recovery-key">Recovery API key</label><input id="reset-recovery-key" type="password" autoComplete="off" required value={key} onChange={e => setKey(e.target.value)} />
          <label htmlFor="reset-username">Owner username</label><input id="reset-username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} />
          <label htmlFor="reset-password">New password (min. 8 characters)</label><input id="reset-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
          <label htmlFor="reset-password-confirm">Confirm new password</label><input id="reset-password-confirm" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
          <button type="submit">{busy ? 'Resetting password…' : 'Reset password'}</button>
        </div>
      </fieldset></form>
      {error && <p role="alert">{error}</p>}
      <details style={{ marginTop: 16 }}><summary>I don’t have my API key</summary>
        <p>If another browser is signed in, find the key under Settings → General → Integration API key. You can also use configured Google sign-in and change your password under Owner account.</p>
        <p>If you are locked out, the server administrator can run this in the Docker host terminal to generate a recovery password for the existing owner:</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>docker exec vidarr node dist/scripts/recoverOwnerLogin.js --yes</pre>
        <p>The command prints the owner username and a generated password. It preserves the library, API key and connected services. Use the resulting credentials on the normal sign-in page.</p>
      </details>
      <p><a href="#sign-in" onClick={e => { e.preventDefault(); if (!busy) onCancel(); }}>Back to sign in</a></p>
    </div>
  </div>;
}

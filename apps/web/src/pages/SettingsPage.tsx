import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setStoredApiKey } from '../api/client';
import { renderNamingFormat } from '@vidarr/shared-types';
import type { RecommendationProviderConfig, TransferMode } from '@vidarr/shared-types';

function SecuritySection({ apiKey }: { apiKey: string | null }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState(false);

  const regenerate = useMutation({
    mutationFn: api.settings.regenerateApiKey,
    onSuccess: (result) => {
      // Keep this browser's own session working — it just proved it already
      // held the old valid key, so it's the one authorized to rotate it.
      if (result.apiKey) setStoredApiKey(result.apiKey);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Security</h3>
      <div className="form-row" style={{ alignItems: 'center' }}>
        <input readOnly type={revealed ? 'text' : 'password'} value={apiKey ?? ''} style={{ minWidth: 320 }} />
        <button type="button" className="secondary" onClick={() => setRevealed((v) => !v)}>
          {revealed ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="secondary" onClick={() => regenerate.mutate()}>
          {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
      <p className="empty-state" style={{ padding: '6px 0 0' }}>
        Required on every request (sent as the <code>X-Api-Key</code> header). Regenerating
        immediately signs out every other browser/session using the old key.
      </p>
    </div>
  );
}

function GoogleSignOnSection({
  googleClientId,
  googleClientSecret,
  googleAllowedEmail,
}: {
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleAllowedEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(googleClientId ?? '');
  const [clientSecret, setClientSecret] = useState(googleClientSecret ?? '');
  const [allowedEmail, setAllowedEmail] = useState(googleAllowedEmail ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.settings.update({
        googleClientId: clientId || null,
        googleClientSecret: clientSecret || null,
        googleAllowedEmail: allowedEmail || null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const redirectUri =
    typeof window !== 'undefined' ? `${window.location.origin}/api/v1/auth/google/callback` : '';

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Google Sign-On</h3>
      <p className="empty-state" style={{ padding: '0 0 8px' }}>
        An alternative way to log into this web UI besides typing the API key directly — only the
        one account below can use it. The API key itself is unchanged and still required for every
        API request.
      </p>
      <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label htmlFor="google-client-id">Client ID</label>
        <input id="google-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </div>
      <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label htmlFor="google-client-secret">Client Secret</label>
        <input
          id="google-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
      <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label htmlFor="google-allowed-email">Allowed Google account</label>
        <input
          id="google-allowed-email"
          type="email"
          placeholder="you@example.com"
          value={allowedEmail}
          onChange={(e) => setAllowedEmail(e.target.value)}
        />
      </div>
      <button type="button" onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      <p className="empty-state" style={{ padding: '8px 0 0' }}>
        In the Google Cloud Console, create an OAuth Client ID (type "Web application") and add this
        exact URL as an authorized redirect URI: <code>{redirectUri}</code>
      </p>
    </div>
  );
}

function LocalLoginSection({ adminUsername }: { adminUsername: string | null }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(adminUsername ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.settings.setLoginCredentials(username, password),
    onSuccess: () => {
      setPassword('');
      setConfirmPassword('');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to save.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (password !== confirmPassword) {
      setFormError("Passwords don't match.");
      return;
    }
    save.mutate();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Username &amp; Password Login</h3>
      <p className="empty-state" style={{ padding: '0 0 8px' }}>
        Another alternative to typing the API key directly. The API key itself is unchanged and
        still required for every API request — signing in here just hands your browser that same
        key after checking these credentials.
        {adminUsername && (
          <>
            {' '}
            Currently signed in as <strong>{adminUsername}</strong>.
          </>
        )}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="admin-username">Username</label>
          <input id="admin-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="admin-password">
            {adminUsername ? 'New password' : 'Password'} (min. 8 characters)
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="admin-password-confirm">Confirm password</label>
          <input
            id="admin-password-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : adminUsername ? 'Update login' : 'Set up login'}
        </button>
        {formError && <p className="empty-state">{formError}</p>}
      </form>
    </div>
  );
}

const NAMING_PREVIEW_TOKENS = {
  artistName: 'Sample Artist',
  videoTitle: 'Sample Video Title',
  year: 2024,
  quality: '1080p',
};

const PROVIDER_LABEL: Record<string, string> = {
  lastfm: 'Last.fm',
  spotify: 'Spotify',
  musicbrainz: 'MusicBrainz',
};

function ProviderRow({ config }: { config: RecommendationProviderConfig }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(config.enabled);
  const [apiKey, setApiKey] = useState(config.apiKey ?? '');
  const [clientId, setClientId] = useState(config.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(config.clientSecret ?? '');

  const update = useMutation({
    mutationFn: () =>
      api.recommendationProviders.update(config.provider, {
        enabled,
        apiKey: apiKey || null,
        clientId: clientId || null,
        clientSecret: clientSecret || null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recommendationProviders'] }),
  });

  return (
    <div className="form-row" style={{ alignItems: 'center' }}>
      <label style={{ width: 110 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
        {PROVIDER_LABEL[config.provider] ?? config.provider}
      </label>
      {config.provider === 'spotify' ? (
        <>
          <input
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            placeholder="Client Secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </>
      ) : config.provider === 'lastfm' ? (
        <input placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      ) : (
        <span className="empty-state" style={{ padding: 0 }}>
          No credentials required
        </span>
      )}
      <button type="button" onClick={() => update.mutate()}>
        Save
      </button>
    </div>
  );
}

function RecommendationProvidersSection() {
  const providers = useQuery({
    queryKey: ['recommendationProviders'],
    queryFn: api.recommendationProviders.list,
  });

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Recommendation Providers</h3>
      {providers.data?.map((p) => (
        <ProviderRow key={p.provider} config={p} />
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const [namingFormat, setNamingFormat] = useState('');
  const [transferMode, setTransferMode] = useState<TransferMode>('hardlink');
  const [minFreeSpaceMb, setMinFreeSpaceMb] = useState(1024);
  const [imvdbApiKey, setImvdbApiKey] = useState('');

  useEffect(() => {
    if (settings.data) {
      setNamingFormat(settings.data.namingFormat);
      setTransferMode(settings.data.transferMode);
      setMinFreeSpaceMb(settings.data.minFreeSpaceMb);
      setImvdbApiKey(settings.data.imvdbApiKey ?? '');
    }
  }, [settings.data]);

  const update = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ namingFormat, transferMode, minFreeSpaceMb, imvdbApiKey: imvdbApiKey || null });
        }}
      >
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="imvdb-api-key">IMVDb API key</label>
          <input id="imvdb-api-key" value={imvdbApiKey} onChange={(e) => setImvdbApiKey(e.target.value)} />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="naming-format">Naming format</label>
          <input id="naming-format" value={namingFormat} onChange={(e) => setNamingFormat(e.target.value)} />
          <span className="empty-state" style={{ padding: '4px 0 0' }}>
            Preview: {renderNamingFormat(namingFormat, NAMING_PREVIEW_TOKENS)}
            {'.mp4'}
          </span>
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="transfer-mode">Transfer mode</label>
          <select
            id="transfer-mode"
            value={transferMode}
            onChange={(e) => setTransferMode(e.target.value as TransferMode)}
          >
            <option value="hardlink">Hardlink</option>
            <option value="copy">Copy</option>
            <option value="move">Move</option>
          </select>
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="min-free-space">Minimum free space (MB)</label>
          <input
            id="min-free-space"
            type="number"
            value={minFreeSpaceMb}
            onChange={(e) => setMinFreeSpaceMb(Number(e.target.value))}
          />
        </div>
        <button type="submit">Save</button>
      </form>

      <SecuritySection apiKey={settings.data?.apiKey ?? null} />
      <LocalLoginSection adminUsername={settings.data?.adminUsername ?? null} />
      <GoogleSignOnSection
        googleClientId={settings.data?.googleClientId ?? null}
        googleClientSecret={settings.data?.googleClientSecret ?? null}
        googleAllowedEmail={settings.data?.googleAllowedEmail ?? null}
      />
      <RecommendationProvidersSection />
    </div>
  );
}

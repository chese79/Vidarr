import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setStoredApiKey } from '../api/client';
import { renderNamingFormat } from '@vidarr/shared-types';
import type { RecommendationProviderConfig, TransferMode } from '@vidarr/shared-types';
import { LastFmAccountSection } from '../components/LastFmAccountSection';
import { credentialPlaceholder } from '../credentialFields';
import { YoutubeCookiesSection } from '../components/YoutubeCookiesSection';

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
      <h3 style={{ marginTop: 0 }}>Integration API key</h3>
      <div className="form-row" style={{ alignItems: 'center' }}>
        <input
          readOnly
          type={revealed ? 'text' : 'password'}
          value={apiKey ?? ''}
          aria-label="Integration API key"
          style={{ minWidth: 320 }}
        />
        <button type="button" className="secondary" onClick={() => setRevealed((v) => !v)}>
          {revealed ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="secondary" onClick={() => regenerate.mutate()}>
          {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
      {regenerate.isSuccess && (
        <p className="empty-state" role="status" style={{ padding: '6px 0 0' }}>
          Key regenerated.
        </p>
      )}
      {regenerate.isError && (
        <p className="empty-state" role="alert" style={{ padding: '6px 0 0' }}>
          Failed to regenerate: {(regenerate.error as Error).message}
        </p>
      )}
      <p className="empty-state" style={{ padding: '6px 0 0' }}>
        For scripts and third-party integrations that call Vidarr directly. You do not need this
        key to sign in to the web interface. Regenerating it signs out other browser sessions.
      </p>
    </div>
  );
}

function GoogleSignOnSection({
  googleClientId,
  hasGoogleClientSecret,
  googleAllowedEmail,
}: {
  googleClientId: string | null;
  hasGoogleClientSecret: boolean;
  googleAllowedEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(googleClientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [allowedEmail, setAllowedEmail] = useState(googleAllowedEmail ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.settings.update({
        googleClientId: clientId || null,
        ...(clientSecret ? { googleClientSecret: clientSecret } : {}),
        googleAllowedEmail: allowedEmail || null,
      }),
    onSuccess: () => {
      setClientSecret('');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const redirectUri =
    typeof window !== 'undefined' ? `${window.location.origin}/api/v1/auth/google/callback` : '';

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Google Sign-On</h3>
      <p className="empty-state" style={{ padding: '0 0 8px' }}>
        Optional alternative to the owner username and password. Only the Google account below can
        use it.
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
          placeholder={credentialPlaceholder(hasGoogleClientSecret, 'Client secret')}
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
      {save.isSuccess && (
        <p className="empty-state" role="status" style={{ padding: '6px 0 0' }}>
          Saved.
        </p>
      )}
      {save.isError && (
        <p className="empty-state" role="alert" style={{ padding: '6px 0 0' }}>
          Failed to save: {(save.error as Error).message}
        </p>
      )}
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
      <h3 style={{ marginTop: 0 }}>Owner account</h3>
      <p className="empty-state" style={{ padding: '0 0 8px' }}>
        Use this username and password to sign in to the Vidarr web interface.
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
            placeholder={credentialPlaceholder(Boolean(adminUsername), 'Password')}
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
        {formError && (
          <p className="empty-state" role="alert">
            {formError}
          </p>
        )}
        {save.isSuccess && (
          <p className="empty-state" role="status">
            Saved.
          </p>
        )}
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

export function ProviderRow({ config }: { config: RecommendationProviderConfig }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(config.enabled);
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState(config.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');

  const update = useMutation({
    mutationFn: () =>
      api.recommendationProviders.update(config.provider, {
        enabled,
        clientId: clientId || null,
        ...(apiKey ? { apiKey } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      }),
    onSuccess: () => {
      setApiKey('');
      setClientSecret('');
      queryClient.invalidateQueries({ queryKey: ['recommendationProviders'] });
      queryClient.invalidateQueries({ queryKey: ['lastfm'] });
    },
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
            aria-label="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            placeholder={credentialPlaceholder(config.hasClientSecret, 'Client Secret')}
            aria-label="Client Secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </>
      ) : config.provider === 'lastfm' ? (
        <>
        <input
          placeholder={credentialPlaceholder(config.hasApiKey, 'API key')}
          aria-label="API key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <input
          placeholder={credentialPlaceholder(config.hasClientSecret, 'Shared secret')}
          aria-label="Last.fm shared secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        </>
      ) : (
        <span className="empty-state" style={{ padding: 0 }}>
          No credentials required
        </span>
      )}
      <button
        type="button"
        aria-label={`Save ${PROVIDER_LABEL[config.provider] ?? config.provider} settings`}
        onClick={() => update.mutate()}
      >
        Save
      </button>
      {update.isSuccess && (
        <span className="empty-state" role="status" style={{ padding: 0 }}>
          Saved.
        </span>
      )}
      {update.isError && (
        <span className="empty-state" role="alert" style={{ padding: 0 }}>
          Failed: {(update.error as Error).message}
        </span>
      )}
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
  const [transferMode, setTransferMode] = useState<TransferMode>('move');
  const [minFreeSpaceMb, setMinFreeSpaceMb] = useState(1024);
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(3);
  const [warnBeforeDelete, setWarnBeforeDelete] = useState(true);
  const [excludeDeletedVideosFromScans, setExcludeDeletedVideosFromScans] = useState(false);
  const [imvdbApiKey, setImvdbApiKey] = useState('');

  useEffect(() => {
    if (settings.data) {
      setNamingFormat(settings.data.namingFormat);
      setTransferMode(settings.data.transferMode);
      setMinFreeSpaceMb(settings.data.minFreeSpaceMb);
      setMaxConcurrentDownloads(settings.data.maxConcurrentDownloads ?? 3);
      setWarnBeforeDelete(settings.data.warnBeforeDelete ?? true);
      setExcludeDeletedVideosFromScans(settings.data.excludeDeletedVideosFromScans ?? false);
      setImvdbApiKey('');
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
          update.mutate({
            namingFormat,
            transferMode,
            minFreeSpaceMb,
            maxConcurrentDownloads,
            warnBeforeDelete,
            excludeDeletedVideosFromScans,
            ...(imvdbApiKey ? { imvdbApiKey } : {}),
          });
        }}
      >
        <h3 style={{ marginTop: 0 }}>Library</h3>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="imvdb-api-key">IMVDb API key</label>
          <input
            id="imvdb-api-key"
            type="password"
            placeholder={credentialPlaceholder(settings.data?.hasImvdbApiKey, 'API key')}
            value={imvdbApiKey}
            onChange={(e) => setImvdbApiKey(e.target.value)}
          />
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
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label htmlFor="max-concurrent-downloads">Simultaneous video downloads</label>
          <input id="max-concurrent-downloads" type="number" min={1} max={20} required
            value={maxConcurrentDownloads} onChange={e => setMaxConcurrentDownloads(Number(e.target.value))} />
          <span className="empty-state" style={{ padding: '4px 0 0' }}>Default: 3. Additional videos wait in the queue.</span>
        </div>
        <h3>Qualified plays</h3>
        <p>Qualified plays are tracked independently of Last.fm: half the video or four minutes of observed watching, whichever comes first. Pauses, buffering, seeks and unobserved gaps earn no time. Counts begin with this release; existing server play counts remain separate. Connector settings explain optional Jellyfin playback notifications.</p>
        <h3>Video deletion</h3>
        <div className="form-row">
          <label><input type="checkbox" checked={warnBeforeDelete} onChange={e => setWarnBeforeDelete(e.target.checked)} />Warn before delete</label>
          <label><input type="checkbox" checked={excludeDeletedVideosFromScans} onChange={e => setExcludeDeletedVideosFromScans(e.target.checked)} />Exclude deleted videos from future scans</label>
        </div>
        <p>Delete permanently removes the local video bundle, confirmed matched Jellyfin/Plex copies and the Vidarr entry. Active or waiting downloads must first be removed from Queue.</p>
        <p>Deletion starts after five minutes. Playing or paused server sessions defer removal. Failures retry 40 minutes later; the entry and next attempt stay visible until deletion finishes, including across restarts.</p>
        <p>Exclusion is off by default. When enabled, deletion fingerprints suppress future IMVDb, YouTube and local-file rediscovery. Turning it off permits rediscovery; it does not restore deleted files. Existing catalog entries are not removed by changing this option.</p>
        <button type="submit">Save</button>
        {update.isSuccess && (
          <p className="empty-state" role="status">
            Saved.
          </p>
        )}
        {update.isError && (
          <p className="empty-state" role="alert">
            Failed to save: {(update.error as Error).message}
          </p>
        )}
      </form>

      <YoutubeCookiesSection />
      <SecuritySection apiKey={settings.data?.apiKey ?? null} />
      <LocalLoginSection adminUsername={settings.data?.adminUsername ?? null} />
      <GoogleSignOnSection
        googleClientId={settings.data?.googleClientId ?? null}
        hasGoogleClientSecret={settings.data?.hasGoogleClientSecret ?? false}
        googleAllowedEmail={settings.data?.googleAllowedEmail ?? null}
      />
      <RecommendationProvidersSection />
      <LastFmAccountSection />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { renderNamingFormat } from '@vidarr/shared-types';
import type { RecommendationProviderConfig, TransferMode } from '@vidarr/shared-types';

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
          <label>IMVDb API key</label>
          <input value={imvdbApiKey} onChange={(e) => setImvdbApiKey(e.target.value)} />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>Naming format</label>
          <input value={namingFormat} onChange={(e) => setNamingFormat(e.target.value)} />
          <span className="empty-state" style={{ padding: '4px 0 0' }}>
            Preview: {renderNamingFormat(namingFormat, NAMING_PREVIEW_TOKENS)}
            {'.mp4'}
          </span>
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>Transfer mode</label>
          <select
            value={transferMode}
            onChange={(e) => setTransferMode(e.target.value as TransferMode)}
          >
            <option value="hardlink">Hardlink</option>
            <option value="copy">Copy</option>
            <option value="move">Move</option>
          </select>
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>Minimum free space (MB)</label>
          <input
            type="number"
            value={minFreeSpaceMb}
            onChange={(e) => setMinFreeSpaceMb(Number(e.target.value))}
          />
        </div>
        <button type="submit">Save</button>
      </form>

      <RecommendationProvidersSection />
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MusicVideo, IndexerSearchResult, YoutubeSourceType } from '@vidarr/shared-types';
import { api } from '../api/client';
import { ActionButton, ActionForm } from './ButtonFeedback';

export function ReleaseSearchPanel({ video, onClose }: { video: MusicVideo; onClose: () => void }) {
  const queryClient = useQueryClient();
  // Keyed by downloadUrl (the release's real identity) rather than array
  // index, so grab state stays attached to the right row if results ever
  // re-sort.
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabMessage, setGrabMessage] = useState<string | null>(null);

  const downloadClients = useQuery({
    queryKey: ['downloadClients'],
    queryFn: api.downloadClients.list,
  });

  const results = useQuery({
    queryKey: ['search', video.id],
    queryFn: () => api.search.forVideo(video.id),
  });

  async function handleGrab(result: IndexerSearchResult) {
    if (!downloadClients.data?.length) return;
    setGrabbing(result.downloadUrl);
    setGrabMessage(null);
    const outcome = await api.search.grabRelease(video.id, {
      downloadClientId: downloadClients.data[0].id,
      downloadUrl: result.downloadUrl,
      quality: result.quality,
    });
    setGrabMessage(outcome.ok ? 'Sent to download client' : `Failed: ${outcome.error}`);
    setGrabbing(null);
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  }

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Search results — {video.title}</h3>
        <ActionButton className="secondary" onClick={onClose}>
          Close
        </ActionButton>
      </div>

      {!downloadClients.data?.length && (
        <p className="empty-state">Add a download client before grabbing a release.</p>
      )}
      {results.isLoading && <p className="empty-state">Searching…</p>}
      {results.isError && <p className="empty-state">{(results.error as Error).message}</p>}
      {grabMessage && (
        <p className="empty-state" role="status">
          {grabMessage}
        </p>
      )}

      {results.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Indexer</th>
              <th>Quality</th>
              <th>Size</th>
              <th>Seeders</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.data.map((r) => (
              <tr key={r.downloadUrl}>
                <td>{r.title}</td>
                <td>{r.indexerName}</td>
                <td>{r.quality}</td>
                <td>{r.sizeBytes ? `${(r.sizeBytes / 1_000_000_000).toFixed(2)} GB` : '—'}</td>
                <td>{r.seeders ?? '—'}</td>
                <td>
                  <ActionButton
                    disabled={!downloadClients.data?.length || grabbing === r.downloadUrl}
                    onClick={() => handleGrab(r)}
                  >
                    {grabbing === r.downloadUrl ? 'Grabbing…' : 'Grab'}
                  </ActionButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !results.isLoading && !results.isError && <p className="empty-state">No results.</p>
      )}
    </div>
  );
}

export function YoutubeSourcesSection({ artistId }: { artistId: number }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<YoutubeSourceType>('channel');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Record<number, string>>({});

  const sources = useQuery({
    queryKey: ['youtubeSources', artistId],
    queryFn: () => api.youtubeSources.list(artistId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['youtubeSources', artistId] });
    queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
  };

  const createSource = useMutation({
    mutationFn: api.youtubeSources.create,
    onSuccess: () => {
      invalidate();
      setUrl('');
    },
  });

  const removeSource = useMutation({
    mutationFn: api.youtubeSources.remove,
    onSuccess: invalidate,
  });

  async function handleSync(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Syncing…' }));
    try {
      const result = await api.youtubeSources.sync(id);
      setStatus((s) => ({
        ...s,
        [id]: `${result.matched} matched, ${result.pending} pending video review`,
      }));
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>YouTube Sources</h3>
      <ActionForm
        className="form-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url) return;
          createSource.mutate({ artistId, type, url, monitored: true });
        }}
      >
        <select value={type} onChange={(e) => setType(e.target.value as YoutubeSourceType)}>
          <option value="channel">Channel</option>
          <option value="playlist">Playlist</option>
          <option value="single_video">Single video</option>
        </select>
        <input
          placeholder="YouTube URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ minWidth: 320 }}
          required
        />
        <ActionButton type="submit">Add</ActionButton>
      </ActionForm>

      {sources.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>URL</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.data.map((s) => (
              <tr key={s.id}>
                <td>{s.type}</td>
                <td>{s.url}</td>
                <td role="status">{status[s.id] ?? (s.lastPolledAt ? 'Synced' : 'Never synced')}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <ActionButton className="secondary" onClick={() => handleSync(s.id)}>
                    Sync
                  </ActionButton>
                  <ActionButton className="secondary" onClick={() => removeSource.mutate(s.id)}>
                    Remove
                  </ActionButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No YouTube sources yet.</p>
      )}
    </div>
  );
}


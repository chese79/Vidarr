import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import VideoThumb from '../components/VideoThumb';
import type { MatchMode, PlaylistFilters } from '@vidarr/shared-types';

function GeneratePlaylistPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('all');
  const [smart, setSmart] = useState(false);
  const [regenerateIntervalMinutes, setRegenerateIntervalMinutes] = useState<number | null>(null);

  const [enableYear, setEnableYear] = useState(false);
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');

  const [enableGenre, setEnableGenre] = useState(false);
  const [genre, setGenre] = useState('');

  const [enablePlayCount, setEnablePlayCount] = useState(false);
  const [minPlayCount, setMinPlayCount] = useState('');

  const [enableArtists, setEnableArtists] = useState(false);
  const [artistIds, setArtistIds] = useState<number[]>([]);

  const [enableVideos, setEnableVideos] = useState(false);
  const [videoIds, setVideoIds] = useState<number[]>([]);

  const [result, setResult] = useState<string | null>(null);

  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list, enabled: open });
  const downloaded = useQuery({
    queryKey: ['musicVideos', 'playable'],
    queryFn: () => api.musicVideos.list({ playable: true }),
    enabled: open,
  });

  const generate = useMutation({
    mutationFn: (filters: PlaylistFilters) => api.playlists.generate({ name, filters, matchMode, smart, regenerateIntervalMinutes }),
    onSuccess: (r) => {
      setResult(`Created "${name}" with ${r.matchedCount} video(s).`);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName('');
    },
    onError: (err) => setResult(`Failed: ${(err as Error).message}`),
  });

  const anyEnabled = enableYear || enableGenre || enablePlayCount || enableArtists || enableVideos;

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !anyEnabled) return;
    const filters: PlaylistFilters = {};
    if (enableYear) {
      if (yearMin) filters.yearMin = Number(yearMin);
      if (yearMax) filters.yearMax = Number(yearMax);
    }
    if (enableGenre && genre.trim()) filters.genre = genre.trim();
    if (enablePlayCount && minPlayCount) filters.minPlayCount = Number(minPlayCount);
    if (enableArtists && artistIds.length) filters.artistIds = artistIds;
    if (enableVideos && videoIds.length) filters.musicVideoIds = videoIds;
    generate.mutate(filters);
  }

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Generate from filters…
      </button>
    );
  }

  return (
    <form className="card" onSubmit={handleGenerate}>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Generate playlist from filters</h3>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div className="form-row">
        <input
          placeholder="Playlist name"
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 220 }}
          required
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name="matchMode"
            checked={matchMode === 'all'}
            onChange={() => setMatchMode('all')}
          />
          Match ALL enabled filters (AND)
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name="matchMode"
            checked={matchMode === 'any'}
            onChange={() => setMatchMode('any')}
          />
          Match ANY enabled filter (OR)
        </label>
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label><input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} /> Save as smart playlist</label>
        {smart && <select aria-label="Regeneration schedule" value={regenerateIntervalMinutes ?? ''} onChange={(e) => setRegenerateIntervalMinutes(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Manual regeneration</option>
          <option value="1440">Daily</option>
          <option value="10080">Weekly</option>
        </select>}
      </div>
      {smart && <p className="empty-state">Regeneration updates this list in Vidarr. Push it to a library to publish the updated list.</p>}

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140 }}>
          <input type="checkbox" checked={enableYear} onChange={(e) => setEnableYear(e.target.checked)} />
          Year range
        </label>
        <input
          type="number"
          placeholder="Min year"
          aria-label="Minimum year"
          value={yearMin}
          onChange={(e) => setYearMin(e.target.value)}
          disabled={!enableYear}
          style={{ width: 110 }}
        />
        <input
          type="number"
          placeholder="Max year"
          aria-label="Maximum year"
          value={yearMax}
          onChange={(e) => setYearMax(e.target.value)}
          disabled={!enableYear}
          style={{ width: 110 }}
        />
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140 }}>
          <input type="checkbox" checked={enableGenre} onChange={(e) => setEnableGenre(e.target.checked)} />
          Genre
        </label>
        <input
          placeholder="e.g. Rock"
          aria-label="Genre"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          disabled={!enableGenre}
          style={{ minWidth: 180 }}
        />
        <span className="empty-state" style={{ padding: 0 }}>
          matches artist or video genre, partial match
        </span>
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140 }}>
          <input
            type="checkbox"
            checked={enablePlayCount}
            onChange={(e) => setEnablePlayCount(e.target.checked)}
          />
          Min play count
        </label>
        <input
          type="number"
          min={0}
          placeholder="e.g. 5"
          aria-label="Minimum play count"
          value={minPlayCount}
          onChange={(e) => setMinPlayCount(e.target.value)}
          disabled={!enablePlayCount}
          style={{ width: 110 }}
        />
        <span className="empty-state" style={{ padding: 0 }}>
          requires a library connector's "Sync Play Counts" to have run
        </span>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={enableArtists}
            onChange={(e) => setEnableArtists(e.target.checked)}
          />
          Artist
        </label>
        <select
          multiple
          aria-label="Filter by artist"
          disabled={!enableArtists}
          value={artistIds.map(String)}
          onChange={(e) => setArtistIds([...e.target.selectedOptions].map((o) => Number(o.value)))}
          style={{ minWidth: 220, height: 90 }}
        >
          {artists.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={enableVideos}
            onChange={(e) => setEnableVideos(e.target.checked)}
          />
          Specific video
        </label>
        <select
          multiple
          aria-label="Filter by specific video"
          disabled={!enableVideos}
          value={videoIds.map(String)}
          onChange={(e) => setVideoIds([...e.target.selectedOptions].map((o) => Number(o.value)))}
          style={{ minWidth: 280, height: 90 }}
        >
          {downloaded.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.artist.name} - {v.title}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={!anyEnabled || generate.isPending}>
        {generate.isPending ? 'Generating…' : 'Generate Playlist'}
      </button>
      {!anyEnabled && (
        <span className="empty-state" style={{ marginLeft: 10 }}>
          Enable at least one filter above.
        </span>
      )}
      {result && (
        <p className="empty-state" role="status">
          {result}
        </p>
      )}
    </form>
  );
}

function PlaylistCard({ playlistId }: { playlistId: number }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pushStatus, setPushStatus] = useState<Record<number, string>>({});

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const playlist = playlists.data?.find((p) => p.id === playlistId);

  const downloaded = useQuery({
    queryKey: ['musicVideos', 'playable'],
    queryFn: () => api.musicVideos.list({ playable: true }),
    enabled: adding,
  });

  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['playlists'] });

  const addItem = useMutation({
    mutationFn: (musicVideoId: number) => api.playlists.addItem(playlistId, musicVideoId),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (musicVideoId: number) => api.playlists.removeItem(playlistId, musicVideoId),
    onSuccess: invalidate,
  });
  const removePlaylist = useMutation({
    mutationFn: () => api.playlists.remove(playlistId),
    onSuccess: invalidate,
  });
  const regenerate = useMutation({
    mutationFn: () => api.playlists.regenerate(playlistId),
    onSuccess: invalidate,
  });

  async function handlePush(connectorId: number) {
    setPushStatus((s) => ({ ...s, [connectorId]: 'Pushing…' }));
    try {
      const result = await api.playlists.push(playlistId, connectorId);
      setPushStatus((s) => ({
        ...s,
        [connectorId]: result.unmatchedTitles.length
          ? `Pushed — ${result.matchedCount} matched, ${result.unmatchedTitles.length} not found: ${result.unmatchedTitles.join(', ')}`
          : `Pushed — ${result.matchedCount} video(s)`,
      }));
    } catch (err) {
      setPushStatus((s) => ({ ...s, [connectorId]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  if (!playlist) return null;
  const inPlaylist = new Set(playlist.items.map((i) => i.musicVideoId));
  const pushableConnectors = (connectors.data ?? []).filter((c) => c.enabled && c.type !== 'subsonic');

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{playlist.name}{playlist.kind === 'smart' ? ' · Smart' : ''}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {playlist.kind === 'smart' && <button className="secondary" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
          </button>}
          {playlist.kind === 'static' && <button
            className="secondary"
            aria-expanded={adding}
            aria-controls={`playlist-${playlistId}-add-videos`}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? 'Done adding' : 'Add videos'}
          </button>}
          <button
            className="secondary"
            aria-label={`Delete playlist ${playlist.name}`}
            onClick={() => removePlaylist.mutate()}
          >
            Delete playlist
          </button>
        </div>
      </div>
      {playlist.kind === 'smart' && <p className="empty-state" style={{ padding: '0 0 8px' }}>
        {playlist.regenerateIntervalMinutes === 1440 ? 'Regenerates daily' : playlist.regenerateIntervalMinutes === 10080 ? 'Regenerates weekly' : 'Regenerates manually'}
      </p>}

      {playlist.items.length ? (
        <div className="video-list">
          {playlist.items.map((item) => (
            <div className="video-row" key={item.id}>
              <VideoThumb url={item.musicVideo.thumbnailUrl} />
              <div className="video-info">
                <strong>{item.musicVideo.title}</strong>
                <span className="empty-state" style={{ padding: 0 }}>
                  {item.musicVideo.artist.name}
                </span>
              </div>
              <div className="video-actions">
                {playlist.kind === 'static' && <button
                  className="secondary"
                  aria-label={`Remove ${item.musicVideo.title} from playlist`}
                  onClick={() => removeItem.mutate(item.musicVideoId)}
                >
                  Remove
                </button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No videos in this playlist yet.</p>
      )}

      {adding && (
        <div className="video-list" id={`playlist-${playlistId}-add-videos`} style={{ marginTop: 8 }}>
          {(downloaded.data ?? [])
            .filter((v) => !inPlaylist.has(v.id))
            .map((v) => (
              <div className="video-row" key={v.id}>
                <div className="video-info">
                  <strong>{v.title}</strong>
                  <span className="empty-state" style={{ padding: 0 }}>
                    {v.artist.name}
                  </span>
                </div>
                <div className="video-actions">
                  <button aria-label={`Add ${v.title} to playlist`} onClick={() => addItem.mutate(v.id)}>
                    Add
                  </button>
                </div>
              </div>
            ))}
          {downloaded.data?.length === 0 && <p className="empty-state">No local or media-server videos available yet.</p>}
        </div>
      )}

      {pushableConnectors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="empty-state" style={{ padding: '0 0 6px' }}>
            Push to library:
          </p>
          {pushableConnectors.map((c) => {
            const sync = playlist.syncs.find((s) => s.connectorId === c.id);
            return (
              <div className="form-row" key={c.id} style={{ alignItems: 'center' }}>
                <button className="secondary" onClick={() => handlePush(c.id)} disabled={!c.videoLibraryId}>
                  Push to {c.name}
                </button>
                {!c.videoLibraryId && (
                  <span className="empty-state" style={{ padding: 0, fontSize: 12 }}>
                    Pick a video library for this connector first.
                  </span>
                )}
                <span className="empty-state" style={{ padding: 0 }} role="status">
                  {pushStatus[c.id] ?? (sync ? `Last: ${sync.lastPushStatus} (${sync.lastPushedAt})` : '—')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PlaylistsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });

  const createPlaylist = useMutation({
    mutationFn: api.playlists.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createPlaylist.mutate({ name });
  }

  return (
    <div>
      <div className="page-header">
        <h2>Playlists</h2>
      </div>

      <form className="form-row" onSubmit={handleSubmit}>
        <input
          placeholder="Playlist name"
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 240 }}
          required
        />
        <button type="submit">Create Playlist</button>
      </form>

      <div style={{ marginBottom: 16 }}>
        <GeneratePlaylistPanel />
      </div>

      {playlists.data?.length ? (
        playlists.data.map((p) => <PlaylistCard key={p.id} playlistId={p.id} />)
      ) : (
        <p className="empty-state">No playlists yet.</p>
      )}
    </div>
  );
}

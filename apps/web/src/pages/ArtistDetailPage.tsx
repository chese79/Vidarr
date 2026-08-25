import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import VideoThumb from '../components/VideoThumb';
import type { YoutubeSourceType, IndexerSearchResult, MusicVideo } from '@vidarr/shared-types';

function ReleaseSearchPanel({ video, onClose }: { video: MusicVideo; onClose: () => void }) {
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
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {!downloadClients.data?.length && (
        <p className="empty-state">Add a download client before grabbing a release.</p>
      )}
      {results.isLoading && <p className="empty-state">Searching…</p>}
      {results.isError && <p className="empty-state">{(results.error as Error).message}</p>}
      {grabMessage && <p className="empty-state">{grabMessage}</p>}

      {results.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Indexer</th>
              <th>Quality</th>
              <th>Size</th>
              <th>Seeders</th>
              <th></th>
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
                  <button
                    disabled={!downloadClients.data?.length || grabbing === r.downloadUrl}
                    onClick={() => handleGrab(r)}
                  >
                    {grabbing === r.downloadUrl ? 'Grabbing…' : 'Grab'}
                  </button>
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

function YoutubeSourcesSection({ artistId }: { artistId: number }) {
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
      const suffix = result.isInitialSync
        ? ' (added as baseline, not auto-downloaded — grab manually if wanted)'
        : ' (new uploads, will be auto-grabbed)';
      setStatus((s) => ({
        ...s,
        [id]: `${result.matched} matched, ${result.created} new${result.created ? suffix : ''}`,
      }));
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>YouTube Sources</h3>
      <form
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
        <button type="submit">Add</button>
      </form>

      {sources.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>URL</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.data.map((s) => (
              <tr key={s.id}>
                <td>{s.type}</td>
                <td>{s.url}</td>
                <td>{status[s.id] ?? (s.lastPolledAt ? 'Synced' : 'Never synced')}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="secondary" onClick={() => handleSync(s.id)}>
                    Sync
                  </button>
                  <button className="secondary" onClick={() => removeSource.mutate(s.id)}>
                    Remove
                  </button>
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

export default function ArtistDetailPage() {
  const { id } = useParams();
  const artistId = Number(id);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [videoGenre, setVideoGenre] = useState('');
  const [genreInput, setGenreInput] = useState('');
  const [genreMessage, setGenreMessage] = useState<string | null>(null);
  const [grabStatus, setGrabStatus] = useState<Record<number, string>>({});
  const [searchingVideo, setSearchingVideo] = useState<MusicVideo | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [monitorMessage, setMonitorMessage] = useState<string | null>(null);
  const [bulkSearching, setBulkSearching] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const artist = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => api.artists.get(artistId),
  });

  useEffect(() => {
    if (artist.data) setGenreInput(artist.data.genre ?? '');
  }, [artist.data?.genre]);

  const updateGenre = useMutation({
    mutationFn: (genre: string) => api.artists.update(artistId, { genre: genre || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artist', artistId] }),
  });

  const matchGenre = useMutation({
    mutationFn: () => api.artists.matchGenre(artistId),
    onSuccess: (result) => {
      setGenreMessage(`Matched "${result.genre}" via ${result.source}`);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    },
    onError: (err) => setGenreMessage((err as Error).message),
  });

  const updateArtist = useMutation({
    mutationFn: (monitored: boolean) => api.artists.update(artistId, { monitored }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      if (result.metadataRefreshError) {
        setMonitorMessage(`Video list refresh failed: ${result.metadataRefreshError}`);
      } else {
        setMonitorMessage(
          result.videosAdded !== undefined ? `${result.videosAdded} video(s) added from IMVDb` : null,
        );
      }
    },
  });

  const createVideo = useMutation({
    mutationFn: api.musicVideos.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      setShowAdd(false);
      setTitle('');
      setReleaseYear('');
      setVideoGenre('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title) return;
    createVideo.mutate({
      artistId,
      title,
      monitored: true,
      releaseYear: releaseYear ? Number(releaseYear) : undefined,
      genre: videoGenre || undefined,
    });
  }

  async function handleGrab(videoId: number) {
    setGrabStatus((s) => ({ ...s, [videoId]: 'Downloading…' }));
    const result = await api.musicVideos.grab(videoId);
    setGrabStatus((s) => ({
      ...s,
      [videoId]: result.ok ? 'Done' : `Failed: ${result.error}`,
    }));
    queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
  }

  if (artist.isLoading) return <p>Loading…</p>;
  if (!artist.data) return <p>Artist not found.</p>;

  const wantedVideos = artist.data.musicVideos.filter((mv) => !mv.hasFile);
  const allSelected = wantedVideos.length > 0 && wantedVideos.every((mv) => selected.has(mv.id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(wantedVideos.map((mv) => mv.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkSearch() {
    setBulkSearching(true);
    setBulkMessage(null);
    const result = await api.musicVideos.bulkSearch([...selected]);
    setBulkMessage(`${result.grabbed} grabbed, ${result.skipped} skipped`);
    setSelected(new Set());
    setBulkSearching(false);
    queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  }

  return (
    <div>
      <div className="page-header">
        <h2>{artist.data.name}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={artist.data.monitored}
              onChange={(e) => updateArtist.mutate(e.target.checked)}
            />
            Monitored
          </label>
          <button onClick={() => setShowAdd((v) => !v)}>Add Video</button>
        </div>
      </div>

      {monitorMessage && <p className="empty-state">{monitorMessage}</p>}

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label htmlFor="artist-genre" className="empty-state" style={{ padding: 0 }}>
          Genre
        </label>
        <input
          id="artist-genre"
          placeholder="e.g. Alternative Rock"
          value={genreInput}
          onChange={(e) => setGenreInput(e.target.value)}
          onBlur={() => genreInput !== (artist.data.genre ?? '') && updateGenre.mutate(genreInput)}
          style={{ minWidth: 200 }}
        />
        <button
          className="secondary"
          onClick={() => matchGenre.mutate()}
          disabled={matchGenre.isPending}
        >
          {matchGenre.isPending ? 'Matching…' : 'Match Genre'}
        </button>
        {genreMessage && <span className="empty-state">{genreMessage}</span>}
      </div>

      {showAdd && (
        <form className="card" onSubmit={handleSubmit}>
          <div className="form-row">
            <input
              placeholder="Video title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <input
              placeholder="Year"
              type="number"
              value={releaseYear}
              onChange={(e) => setReleaseYear(e.target.value)}
            />
            <input
              placeholder="Genre (optional)"
              value={videoGenre}
              onChange={(e) => setVideoGenre(e.target.value)}
            />
            <button type="submit">Save</button>
          </div>
        </form>
      )}

      {wantedVideos.length > 0 && (
        <div className="form-row" style={{ alignItems: 'center' }}>
          <button className="secondary" onClick={toggleSelectAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <button disabled={!selected.size || bulkSearching} onClick={handleBulkSearch}>
            {bulkSearching ? 'Searching…' : `Search Selected (${selected.size})`}
          </button>
          {bulkMessage && <span className="empty-state">{bulkMessage}</span>}
        </div>
      )}

      {artist.data.musicVideos.length ? (
        <div className="video-list">
          {artist.data.musicVideos.map((mv) => (
            <div className="video-row" key={mv.id}>
              {!mv.hasFile && (
                <input
                  type="checkbox"
                  checked={selected.has(mv.id)}
                  onChange={() => toggleOne(mv.id)}
                />
              )}
              <VideoThumb url={mv.thumbnailUrl} />
              <div className="video-info">
                <div>
                  <strong>{mv.title}</strong>{' '}
                  <span className="empty-state" style={{ padding: 0 }}>
                    ({mv.releaseYear ?? 'year unknown'})
                  </span>
                </div>
                {mv.director && (
                  <div className="empty-state" style={{ padding: 0 }}>
                    Director: {mv.director}
                  </div>
                )}
                <div className="empty-state" style={{ padding: 0 }}>
                  {mv.monitored ? 'Monitored' : 'Not monitored'} · {mv.hasFile ? 'Downloaded' : 'Wanted'}
                </div>
              </div>
              <div className="video-actions">
                {grabStatus[mv.id] && <span>{grabStatus[mv.id]}</span>}
                {!mv.hasFile && mv.youtubeVideoId && (
                  <button className="secondary" onClick={() => handleGrab(mv.id)}>
                    Grab
                  </button>
                )}
                {!mv.hasFile && (
                  <button className="secondary" onClick={() => setSearchingVideo(mv)}>
                    Search
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No music videos yet.</p>
      )}

      {searchingVideo && (
        <ReleaseSearchPanel video={searchingVideo} onClose={() => setSearchingVideo(null)} />
      )}

      <YoutubeSourcesSection artistId={artistId} />
    </div>
  );
}

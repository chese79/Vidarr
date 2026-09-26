import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import VideoThumb from '../components/VideoThumb';
import type {
  YoutubeSourceType,
  IndexerSearchResult,
  MusicVideo,
  MatchedLibraryVideo,
  VideoOwnership,
} from '@vidarr/shared-types';

const OWNERSHIP_LABEL: Record<VideoOwnership, string> = {
  both: 'Local + Server',
  local: 'Local',
  server: 'On Server',
  none: 'Missing',
};

function recordingEvidenceLabel(evidence: string): string | null {
  try {
    const parsed = JSON.parse(evidence) as { recordingMatchCount?: number; releaseMatchCount?: number };
    const recordings = parsed.recordingMatchCount ?? 0;
    const releases = parsed.releaseMatchCount ?? 0;
    if (!recordings && !releases) return null;
    return `${recordings} recording${recordings === 1 ? '' : 's'}, ${releases} release${releases === 1 ? '' : 's'} credited`;
  } catch {
    return null;
  }
}

function ArtistHeaderImage({ artistId, name }: { artistId: number; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    api.artists.image(artistId).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artistId]);
  return <div className="artist-image">{url ? <img src={url} alt={`${name} artwork`} /> : name.charAt(0)}</div>;
}

// A compact screenshot for one of a video's media-server matches — same
// blob-proxy pattern as LibraryPage's LibraryVideoThumbnail (the endpoint
// requires an X-Api-Key header a plain <img src> can't attach), just sized
// for an inline badge rather than a grid card.
function MatchedLibraryThumbnail({ match }: { match: MatchedLibraryVideo }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!match.hasThumbnail) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    api.libraryVideos
      .thumbnail(match.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [match.id, match.hasThumbnail]);

  return url ? <img src={url} alt="" className="matched-video-thumb" loading="lazy" /> : null;
}

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
  const [artistActionMessage, setArtistActionMessage] = useState<string | null>(null);

  const artist = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => api.artists.get(artistId),
  });
  const musicbrainzCandidates = useQuery({
    queryKey: ['musicbrainzCandidates', artistId],
    queryFn: () => api.artists.musicbrainzCandidates(artistId),
    enabled: Boolean(artist.data && !artist.data.musicbrainzArtistId),
  });
  const discoverMusicbrainz = useMutation({
    mutationFn: () => api.artists.discoverMusicbrainzCandidates(artistId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['musicbrainzCandidates', artistId] }),
    onError: (error) => setArtistActionMessage(`MusicBrainz search failed: ${(error as Error).message}`),
  });
  const confirmMusicbrainz = useMutation({
    mutationFn: (mbid: string) => api.artists.confirmMusicbrainz(artistId, mbid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      queryClient.invalidateQueries({ queryKey: ['musicbrainzCandidates', artistId] });
    },
    onError: (error) => setArtistActionMessage(`MusicBrainz confirmation failed: ${(error as Error).message}`),
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

  const toggleVideoMonitored = useMutation({
    mutationFn: ({ id, monitored }: { id: number; monitored: boolean }) =>
      api.musicVideos.update(id, { monitored }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artist', artistId] }),
  });

  const toggleVideoIgnored = useMutation({
    mutationFn: ({ id, ignored }: { id: number; ignored: boolean }) =>
      api.musicVideos.update(id, { ignored }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artist', artistId] }),
  });

  const refreshMetadata = useMutation({
    mutationFn: () => api.artists.refreshMetadata(artistId),
    onSuccess: (result) => {
      setArtistActionMessage(`${result.videosAdded} added, ${result.videosUpdated} updated, ${result.videosFlaggedForReview} flagged for review`);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    },
    onError: (error) => setArtistActionMessage(`Refresh failed: ${(error as Error).message}`),
  });
  const reconcile = useMutation({
    mutationFn: () => api.artists.reconcile(artistId),
    onSuccess: (result) => {
      setArtistActionMessage(`${result.confident} confirmed, ${result.review} need review, ${result.unmatched} unmatched`);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    },
  });
  const monitorVideos = useMutation({
    mutationFn: (mode: 'all' | 'none' | 'missing') => api.artists.monitorVideos(artistId, mode),
    onSuccess: (result) => {
      setArtistActionMessage(`${result.updated} video(s) updated`);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    },
  });
  const searchMissing = useMutation({
    mutationFn: () => api.artists.searchMissing(artistId),
    onSuccess: (result) => {
      setArtistActionMessage(`${result.grabbed} grabbed, ${result.skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    },
  });
  const confirmMatch = useMutation({
    mutationFn: api.libraryVideos.confirmMatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artist', artistId] }),
  });
  const rejectMatch = useMutation({
    mutationFn: api.libraryVideos.rejectMatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artist', artistId] }),
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
      // Matches the schema default — spelled out explicitly since the
      // generated type still requires it even though the API applies the
      // same default itself when omitted (same z.infer quirk as `monitored`
      // elsewhere in this codebase).
      ignored: false,
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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ArtistHeaderImage artistId={artistId} name={artist.data.name} />
          <div>
            <h2>{artist.data.name}</h2>
            <div className="artist-meta">
              {artist.data.musicbrainzArtistId ? `MusicBrainz: ${artist.data.musicbrainzArtistId}` : `MusicBrainz: ${artist.data.musicbrainzMatchStatus}`} ·{' '}
              {artist.data.imvdbArtistId ? `IMVDb: ${artist.data.imvdbArtistId}` : 'No IMVDb match'} ·{' '}
              {artist.data.summary.aggregatePlayCount ?? 'unknown'} plays · {artist.data.summary.available}/{artist.data.summary.known} available ·{' '}
              {artist.data.summary.missing} missing · {artist.data.summary.monitored} monitored
            </div>
          </div>
        </div>
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

      <div className="form-row" style={{ alignItems: 'center' }}>
        <button className="secondary" onClick={() => refreshMetadata.mutate()} disabled={refreshMetadata.isPending}>Refresh IMVDb</button>
        <button className="secondary" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>Reconcile inventory</button>
        <button className="secondary" onClick={() => monitorVideos.mutate('all')}>Monitor all</button>
        <button className="secondary" onClick={() => monitorVideos.mutate('none')}>Unmonitor all</button>
        <button className="secondary" onClick={() => monitorVideos.mutate('missing')}>Monitor missing</button>
        <button onClick={() => searchMissing.mutate()} disabled={searchMissing.isPending || !artist.data.monitored}>Search missing monitored</button>
      </div>
      {artistActionMessage && <p role="status" className="empty-state">{artistActionMessage}</p>}

      {!artist.data.musicbrainzArtistId && <section className="card">
        <div className="page-header"><div><h3>Match artist identity</h3><p className="empty-state">Confirm the MusicBrainz artist before Vidarr builds the IMVDb catalog.</p></div><button className="secondary" onClick={() => discoverMusicbrainz.mutate()} disabled={discoverMusicbrainz.isPending}>{discoverMusicbrainz.isPending ? 'Searching…' : 'Find MusicBrainz matches'}</button></div>
        {musicbrainzCandidates.data?.map((candidate) => <div key={candidate.id} className="form-row" style={{ alignItems: 'center' }}><strong>{candidate.name}</strong><span>{candidate.artistType ?? 'Unknown type'} · {candidate.country ?? 'Unknown country'}{candidate.disambiguation ? ` · ${candidate.disambiguation}` : ''} · {Math.round(candidate.score * 100)}%{recordingEvidenceLabel(candidate.evidence) ? ` · ${recordingEvidenceLabel(candidate.evidence)}` : ''}</span><button onClick={() => confirmMusicbrainz.mutate(candidate.musicbrainzArtistId)} disabled={confirmMusicbrainz.isPending}>Confirm</button></div>)}
      </section>}

      {monitorMessage && (
        <p className="empty-state" role="status">
          {monitorMessage}
        </p>
      )}

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
        {genreMessage && (
          <span className="empty-state" role="status">
            {genreMessage}
          </span>
        )}
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
          {bulkMessage && (
            <span className="empty-state" role="status">
              {bulkMessage}
            </span>
          )}
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
                  aria-label={`Select ${mv.title} for bulk search`}
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
                  {mv.durationSeconds != null
                    ? `Duration: ${Math.floor(mv.durationSeconds / 60)}:${String(mv.durationSeconds % 60).padStart(2, '0')}`
                    : 'Duration unknown'}
                  {' · '}{mv.catalogStatus === 'removedReview' ? 'Removed from latest IMVDb catalog — review' : 'In current catalog'}
                </div>
                <div className="empty-state" style={{ padding: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={mv.monitored}
                      onChange={(e) =>
                        toggleVideoMonitored.mutate({ id: mv.id, monitored: e.target.checked })
                      }
                      aria-label={`Monitored — ${mv.monitored ? 'unmonitor' : 'monitor'} ${mv.title}`}
                    />
                    Monitored
                  </label>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={mv.ignored}
                      onChange={(e) =>
                        toggleVideoIgnored.mutate({ id: mv.id, ignored: e.target.checked })
                      }
                      aria-label={`Ignored — ${mv.ignored ? 'un-ignore' : 'ignore'} ${mv.title}`}
                    />
                    Ignored
                  </label>
                </div>
                <div className="video-status-row">
                  <span className={`status-chip ${mv.status.ownership === 'none' ? 'missing' : 'available'}`}>
                    {OWNERSHIP_LABEL[mv.status.ownership]}
                  </span>
                  {mv.status.acquisition === 'downloading' && (
                    <span className="status-chip downloading">Downloading{mv.status.progress != null ? ` ${Math.round(mv.status.progress * 100)}%` : ''}</span>
                  )}
                  {mv.status.acquisition === 'queued' && <span className="status-chip downloading">Queued</span>}
                  {mv.status.acquisition === 'importing' && <span className="status-chip downloading">Importing</span>}
                  {mv.status.acquisition === 'submissionUnknown' && <span className="status-chip failed">Submission unknown</span>}
                  {mv.status.acquisition === 'awaitingServerScan' && <span className="status-chip downloading">Awaiting server scan</span>}
                  {mv.status.acquisition === 'failed' && <span className="status-chip failed">Failed</span>}
                  {mv.ignored && <span className="status-chip ignored">Ignored</span>}
                </div>
                {mv.libraryVideos.length > 0 && (
                  <div className="matched-video-row">
                    {mv.libraryVideos.map((match) => (
                      <span key={match.id} className={`status-chip ${match.matchConfidence ? 'failed' : 'available'}`}>
                        <MatchedLibraryThumbnail match={match} />
                        On {match.connector.name}
                        {match.playCount != null
                          ? ` · played ${match.playCount} ${match.playCount === 1 ? 'time' : 'times'}`
                          : ''}
                        {match.matchConfidence ? ` · ${match.matchConfidence} match` : ''}
                        {match.matchConfidence && (
                          <>
                            <button className="secondary" onClick={() => confirmMatch.mutate(match.id)}>Confirm</button>
                            <button className="secondary" onClick={() => rejectMatch.mutate(match.id)}>Reject</button>
                          </>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {mv.acquisitionSources.length > 0 && (
                  <div className="empty-state" style={{ padding: 0 }}>
                    Sources: {mv.acquisitionSources.map((source) => `${source.provider} (${source.authority})`).join(', ')}
                  </div>
                )}
              </div>
              <div className="video-actions">
                {grabStatus[mv.id] && <span role="status">{grabStatus[mv.id]}</span>}
                {!mv.hasFile && (mv.status.acquisition == null || mv.status.acquisition === 'failed') && !mv.ignored && (
                  <>
                    {mv.youtubeVideoId && (
                      <button className="secondary" onClick={() => handleGrab(mv.id)}>
                        Grab
                      </button>
                    )}
                    <button className="secondary" onClick={() => setSearchingVideo(mv)}>
                      Search
                    </button>
                  </>
                )}
                {!mv.hasFile && mv.ignored && (
                  <span className="empty-state" style={{ padding: 0, fontSize: 12 }}>
                    Ignored — un-ignore to search or grab.
                  </span>
                )}
                {!mv.hasFile && !mv.ignored && mv.status.acquisition != null && mv.status.acquisition !== 'failed' && (
                  <span className="empty-state" style={{ padding: 0, fontSize: 12 }}>
                    Already downloading.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No music videos yet.</p>
      )}

      {artist.data.unmatchedInventory.length > 0 && (
        <div className="card">
          <h3>Inventory needing review</h3>
          {artist.data.unmatchedInventory.map((item) => (
            <div key={item.id} className="form-row">
              <span>{item.title} ({item.releaseYear ?? 'year unknown'}) · {item.connector.name}</span>
              {item.matchConfidence && <button onClick={() => confirmMatch.mutate(item.id)}>Confirm proposed match</button>}
              {item.musicVideoId && <button className="secondary" onClick={() => rejectMatch.mutate(item.id)}>Reject</button>}
            </div>
          ))}
        </div>
      )}

      {searchingVideo && (
        <ReleaseSearchPanel video={searchingVideo} onClose={() => setSearchingVideo(null)} />
      )}

      <YoutubeSourcesSection artistId={artistId} />
    </div>
  );
}

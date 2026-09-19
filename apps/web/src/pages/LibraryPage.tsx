import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ImvdbArtist, ImvdbVideoCandidate, LibraryVideo } from '@vidarr/shared-types';

function LibraryVideoThumbnail({ video }: { video: LibraryVideo }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!video.hasThumbnail) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    api.libraryVideos.thumbnail(video.id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video.id, video.hasThumbnail]);

  return url
    ? <img src={url} alt={`Screenshot from ${video.title}`} loading="lazy" />
    : <div className="library-video-placeholder" aria-label="No screenshot available">▶</div>;
}

function AddArtistForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'imvdb' | 'manual'>('imvdb');
  const [name, setName] = useState('');
  const [rootFolderId, setRootFolderId] = useState<number | ''>('');
  const [qualityProfileId, setQualityProfileId] = useState<number | ''>('');

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ImvdbArtist[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ImvdbArtist | null>(null);
  const [candidateVideos, setCandidateVideos] = useState<ImvdbVideoCandidate[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [adding, setAdding] = useState(false);

  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({
    queryKey: ['qualityProfiles'],
    queryFn: api.qualityProfiles.list,
  });

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    try {
      setSearchResults(await api.imvdb.searchArtists(query));
    } catch (err) {
      setSearchError((err as Error).message);
    }
    setSearching(false);
  }

  async function handleSelect(artist: ImvdbArtist) {
    setSearchError(null);
    setSelected(artist);
    setLoadingVideos(true);
    try {
      setCandidateVideos(await api.imvdb.getArtistVideos(artist.slug, artist.name));
    } catch (err) {
      setSearchError((err as Error).message);
    }
    setLoadingVideos(false);
  }

  async function handleAddImvdb() {
    if (!selected || rootFolderId === '' || qualityProfileId === '') return;
    setAdding(true);
    const artist = await api.artists.create({
      name: selected.name,
      imvdbArtistId: selected.slug,
      monitored: true,
      rootFolderId: Number(rootFolderId),
      qualityProfileId: Number(qualityProfileId),
    });
    for (const video of candidateVideos) {
      try {
        await api.musicVideos.create({
          artistId: artist.id,
          title: video.title,
          imvdbVideoId: video.imvdbVideoId,
          releaseYear: video.year ?? undefined,
          thumbnailUrl: video.thumbnailUrl ?? undefined,
          director: video.director ?? undefined,
          // youtubeVideoId is unique — a rare collision shouldn't stop the
          // rest of the artist's videos from being added.
          youtubeVideoId: video.youtubeVideoId ?? undefined,
          monitored: true,
        });
      } catch {
        // skip this one video (e.g. a rare youtubeVideoId collision) and keep going
      }
    }
    queryClient.invalidateQueries({ queryKey: ['artists'] });
    setAdding(false);
    onDone();
  }

  const createManual = useMutation({
    mutationFn: api.artists.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      onDone();
    },
  });

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || rootFolderId === '' || qualityProfileId === '') return;
    createManual.mutate({
      name,
      monitored: true,
      rootFolderId: Number(rootFolderId),
      qualityProfileId: Number(qualityProfileId),
    });
  }

  const rootFolderSelect = (
    <select value={rootFolderId} onChange={(e) => setRootFolderId(Number(e.target.value))} required>
      <option value="">Root folder…</option>
      {rootFolders.data?.map((rf) => (
        <option key={rf.id} value={rf.id}>
          {rf.path}
        </option>
      ))}
    </select>
  );

  const qualityProfileSelect = (
    <select
      value={qualityProfileId}
      onChange={(e) => setQualityProfileId(Number(e.target.value))}
      required
    >
      <option value="">Quality profile…</option>
      {qualityProfiles.data?.map((qp) => (
        <option key={qp.id} value={qp.id}>
          {qp.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="card">
      <div className="form-row">
        <button
          type="button"
          className={mode === 'imvdb' ? '' : 'secondary'}
          onClick={() => setMode('imvdb')}
        >
          Search IMVDb
        </button>
        <button
          type="button"
          className={mode === 'manual' ? '' : 'secondary'}
          onClick={() => setMode('manual')}
        >
          Add manually
        </button>
      </div>

      {mode === 'imvdb' ? (
        <>
          <form className="form-row" onSubmit={handleSearch}>
            <input
              placeholder="Artist name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <button type="submit" disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>

          {searchError && (
            <p className="empty-state">
              {searchError} (add your IMVDb API key in Settings if you haven't yet)
            </p>
          )}

          {searchResults && !selected && (
            <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {searchResults.length ? (
                searchResults.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className="secondary"
                    onClick={() => handleSelect(a)}
                  >
                    {a.name}
                  </button>
                ))
              ) : (
                <p className="empty-state">No matches found.</p>
              )}
            </div>
          )}

          {selected && (
            <>
              <p className="empty-state">
                {selected.name} —{' '}
                {loadingVideos ? 'looking up videos…' : `${candidateVideos.length} video(s) found on IMVDb`}
              </p>
              <div className="form-row">
                {rootFolderSelect}
                {qualityProfileSelect}
                <button type="button" onClick={handleAddImvdb} disabled={adding || loadingVideos}>
                  {adding ? 'Adding…' : 'Add Artist'}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <form onSubmit={handleManualSubmit}>
          <div className="form-row">
            <input
              placeholder="Artist name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {rootFolderSelect}
            {qualityProfileSelect}
            <button type="submit">Save</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LibraryPage() {
  const [showAdd, setShowAdd] = useState(false);

  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const libraryVideos = useQuery({ queryKey: ['libraryVideos'], queryFn: api.libraryVideos.list });
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({
    queryKey: ['qualityProfiles'],
    queryFn: api.qualityProfiles.list,
  });

  const canAdd = (rootFolders.data?.length ?? 0) > 0 && (qualityProfiles.data?.length ?? 0) > 0;

  return (
    <div>
      <div className="page-header">
        <h2>Library</h2>
        <button onClick={() => setShowAdd((v) => !v)} disabled={!canAdd}>
          Add Artist
        </button>
      </div>

      {!canAdd && (
        <p className="empty-state">
          Add a <Link to="/root-folders">root folder</Link> and a{' '}
          <Link to="/quality-profiles">quality profile</Link> before adding an artist.
        </p>
      )}

      {showAdd && <AddArtistForm onDone={() => setShowAdd(false)} />}

      <section className="library-video-section">
        <div className="section-heading">
          <h3>Music videos on your media servers</h3>
          <span>{libraryVideos.data?.length ?? 0}</span>
        </div>
        {libraryVideos.data?.length ? (
          <div className="library-video-grid">
            {libraryVideos.data.map((video) => (
              <article className="library-video-card" key={video.id}>
                <div className="library-video-image"><LibraryVideoThumbnail video={video} /></div>
                <div className="library-video-metadata">
                  <strong title={video.title}>{video.title}</strong>
                  <span>{video.artistName}{video.releaseYear ? ` · ${video.releaseYear}` : ''}</span>
                  <small>
                    {video.connector.name}
                    {video.playCount !== null ? ` · played ${video.playCount} ${video.playCount === 1 ? 'time' : 'times'}` : ''}
                  </small>
                  <small className={video.musicVideoId ? 'status-owned' : ''}>
                    {video.musicVideoId ? 'Matched in Vidarr catalog' : 'Available on media server'}
                  </small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No scanned music videos yet. Select a music-video library on a connector and sync it.
          </p>
        )}
      </section>

      {artists.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Monitored</th>
            </tr>
          </thead>
          <tbody>
            {artists.data.map((artist) => (
              <tr key={artist.id}>
                <td>
                  <Link to={`/artist/${artist.id}`}>{artist.name}</Link>
                </td>
                <td>{artist.monitored ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No artists yet.</p>
      )}
    </div>
  );
}

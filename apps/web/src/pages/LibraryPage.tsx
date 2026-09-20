import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ArtistSummary, ImvdbArtist, ImvdbVideoCandidate, LibraryVideo } from '@vidarr/shared-types';

const RAIL_LETTERS = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];
const PAGE_SIZE = 25;

function ArtistImage({ artist }: { artist: ArtistSummary }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!artist.hasImage) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    api.artists
      .image(artist.id)
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
  }, [artist.id, artist.hasImage]);

  return (
    <div className="artist-image" aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : artist.name.charAt(0).toUpperCase()}
    </div>
  );
}

// The signature "crate divider" rail — see the Phase 1 design plan. Disabled
// letters (nothing in the library starts with them) can't be focused into
// a dead end; the active letter is the only one that gets the accent color.
function LetterRail({
  availableLetters,
  active,
  onSelect,
}: {
  availableLetters: string[];
  active: string | null;
  onSelect: (letter: string | null) => void;
}) {
  return (
    <nav className="letter-rail" aria-label="Jump to a letter">
      {RAIL_LETTERS.map((letter) => {
        const enabled = availableLetters.includes(letter);
        const isActive = active === letter;
        return (
          <button
            key={letter}
            type="button"
            disabled={!enabled}
            className={isActive ? 'active' : ''}
            aria-current={isActive || undefined}
            onClick={() => onSelect(isActive ? null : letter)}
          >
            {letter}
          </button>
        );
      })}
    </nav>
  );
}

// Lazily loaded on first expand and cached by react-query after that —
// reuses the existing full artist-detail endpoint rather than adding a
// second, lighter-weight one for Phase 1 (the payload here is a handful of
// scalar fields per video, not large enough to justify a separate route).
function ArtistAccordion({ artistId }: { artistId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => api.artists.get(artistId),
  });

  if (isLoading) {
    return (
      <div className="artist-accordion" role="region" aria-label="Videos">
        <span className="empty-state" style={{ padding: 0 }}>
          Loading videos…
        </span>
      </div>
    );
  }

  if (!data?.musicVideos.length) {
    return (
      <div className="artist-accordion" role="region" aria-label="Videos">
        <span className="empty-state" style={{ padding: 0 }}>
          No known videos yet — try refreshing from IMVDb on the artist page, or this artist has no
          IMVDb catalog at all.
        </span>
      </div>
    );
  }

  return (
    <div className="artist-accordion" role="region" aria-label="Videos">
      {data.musicVideos.map((mv) => (
        <div className="artist-accordion-video" key={mv.id}>
          <span className="year">{mv.releaseYear ?? '—'}</span>
          <span className="title" title={mv.title}>
            {mv.title}
          </span>
          <span className={`status-chip ${mv.hasFile ? 'available' : 'missing'}`}>
            {mv.hasFile ? 'Available' : 'Missing'}
          </span>
          <span className="empty-state" style={{ padding: 0 }}>
            {mv.monitored ? 'Monitored' : 'Unmonitored'}
          </span>
          <Link to={`/artist/${artistId}`}>Details</Link>
        </div>
      ))}
    </div>
  );
}

function ArtistRow({
  artist,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onMonitorChange,
}: {
  artist: ArtistSummary;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onMonitorChange: (id: number, monitored: boolean) => void;
}) {
  return (
    <div className="artist-row">
      <div className="artist-row-header">
        <input
          type="checkbox"
          aria-label={`Select ${artist.name}`}
          checked={selected}
          onChange={() => onToggleSelect(artist.id)}
        />
        <ArtistImage artist={artist} />
        <div className="artist-row-main">
          <Link to={`/artist/${artist.id}`} className="artist-name">
            {artist.name}
          </Link>
          <span className="artist-meta">{artist.genre ?? 'Unknown genre'}</span>
        </div>
        <div className="artist-counts">
          <span>
            {artist.availableVideoCount}/{artist.knownVideoCount} known
          </span>
          {artist.missingVideoCount > 0 && <span className="missing">{artist.missingVideoCount} missing</span>}
          {artist.downloadingVideoCount > 0 && (
            <span className="downloading">{artist.downloadingVideoCount} downloading</span>
          )}
          <span>{artist.aggregatePlayCount != null ? `${artist.aggregatePlayCount} plays` : 'plays unknown'}</span>
        </div>
        <div className="artist-row-actions">
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={artist.monitored}
              onChange={(e) => onMonitorChange(artist.id, e.target.checked)}
            />
            Monitored
          </label>
          <button
            type="button"
            className="secondary"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${artist.name}'s videos` : `Expand ${artist.name}'s videos`}
            onClick={() => onToggleExpand(artist.id)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>
      </div>
      {expanded && <ArtistAccordion artistId={artist.id} />}
    </div>
  );
}

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
    // Matches the server's own default (see schema.prisma's comment on
    // Artist.monitored) — spelled out explicitly here since CreateArtist's
    // generated type still requires the field even though the API would
    // apply the same default itself if it were omitted.
    const artist = await api.artists.create({
      name: selected.name,
      imvdbArtistId: selected.slug,
      monitored: false,
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
      monitored: false,
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
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const libraryVideos = useQuery({ queryKey: ['libraryVideos'], queryFn: api.libraryVideos.list });
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({
    queryKey: ['qualityProfiles'],
    queryFn: api.qualityProfiles.list,
  });
  // Reuses the existing plain artist list purely to derive the genre filter's
  // options — no new endpoint needed just for a distinct-values dropdown.
  const allArtists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const genreOptions = [...new Set(allArtists.data?.map((a) => a.genre).filter((g): g is string => Boolean(g)))].sort();

  const canAdd = (rootFolders.data?.length ?? 0) > 0 && (qualityProfiles.data?.length ?? 0) > 0;

  const search = params.get('q') ?? '';
  const genre = params.get('genre') ?? '';
  const monitored = params.get('monitored') as 'true' | 'false' | null;
  const letter = params.get('letter');
  const hasMissing = params.get('missing') === 'true';
  const minKnownVideos = params.get('minKnownVideos') ?? '';
  const minPlayCount = params.get('minPlayCount') ?? '';
  const page = Number(params.get('page') ?? '1');

  // Debounce the search box so typing doesn't fire a request per keystroke —
  // the URL (and therefore the actual query) only updates 300ms after the
  // user stops typing.
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchInput === search) return;
      updateParams({ q: searchInput || null, page: null });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  const summary = useQuery({
    queryKey: ['artistSummary', search, genre, monitored, letter, hasMissing, minKnownVideos, minPlayCount, page],
    queryFn: () =>
      api.artists.summary({
        search: search || undefined,
        genre: genre || undefined,
        monitored: monitored === 'true' ? true : monitored === 'false' ? false : undefined,
        letter: letter || undefined,
        hasMissing: hasMissing || undefined,
        minKnownVideos: minKnownVideos ? Number(minKnownVideos) : undefined,
        minPlayCount: minPlayCount ? Number(minPlayCount) : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const items = summary.data?.items ?? [];
  const totalPages = summary.data ? Math.max(1, Math.ceil(summary.data.total / PAGE_SIZE)) : 1;
  const anyFilterActive = Boolean(
    search || genre || monitored || letter || hasMissing || minKnownVideos || minPlayCount,
  );
  const allVisibleSelected = items.length > 0 && items.every((a) => selectedIds.has(a.id));

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const a of items) next.delete(a.id);
        return next;
      }
      const next = new Set(prev);
      for (const a of items) next.add(a.id);
      return next;
    });
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const monitorOne = useMutation({
    mutationFn: ({ id, monitored: value }: { id: number; monitored: boolean }) =>
      api.artists.update(id, { monitored: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['artistSummary'] }),
  });

  const bulkMonitor = useMutation({
    mutationFn: (value: boolean) => api.artists.bulkMonitor([...selectedIds], value),
    onSuccess: (result, value) => {
      queryClient.invalidateQueries({ queryKey: ['artistSummary'] });
      setBulkMessage(
        result.failed.length
          ? `${result.succeeded.length} updated, ${result.failed.length} failed`
          : `${result.succeeded.length} artist(s) ${value ? 'monitored' : 'unmonitored'}`,
      );
      setSelectedIds(new Set());
    },
  });

  function clearAllFilters() {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  }

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

      <div className="library-layout">
        <LetterRail
          availableLetters={summary.data?.availableLetters ?? []}
          active={letter}
          onSelect={(l) => updateParams({ letter: l, page: null })}
        />

        <div className="library-main">
          <div className="library-filter-bar">
            <input
              placeholder="Search artists"
              aria-label="Search artists"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ minWidth: 200 }}
            />
            <select
              aria-label="Filter by genre"
              value={genre}
              onChange={(e) => updateParams({ genre: e.target.value || null, page: null })}
            >
              <option value="">All genres</option>
              {genreOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by monitored state"
              value={monitored ?? ''}
              onChange={(e) => updateParams({ monitored: e.target.value || null, page: null })}
            >
              <option value="">Monitored: any</option>
              <option value="true">Monitored</option>
              <option value="false">Unmonitored</option>
            </select>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={hasMissing}
                onChange={(e) => updateParams({ missing: e.target.checked ? 'true' : null, page: null })}
              />
              Has missing videos
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              Min known videos
              <input
                type="number"
                min={0}
                aria-label="Minimum known video count"
                value={minKnownVideos}
                onChange={(e) => updateParams({ minKnownVideos: e.target.value || null, page: null })}
                style={{ width: 64 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              Min play count
              <input
                type="number"
                min={0}
                aria-label="Minimum aggregate play count"
                value={minPlayCount}
                onChange={(e) => updateParams({ minPlayCount: e.target.value || null, page: null })}
                style={{ width: 64 }}
              />
            </label>
            {anyFilterActive && (
              <button type="button" className="secondary" onClick={clearAllFilters}>
                Clear all
              </button>
            )}
            <span className="library-result-count">
              {summary.isLoading ? 'Loading…' : `${summary.data?.total ?? 0} artist(s)`}
            </span>
          </div>

          {selectedIds.size > 0 && (
            <div className="bulk-action-bar">
              <span>{selectedIds.size} selected</span>
              <button
                type="button"
                className="secondary"
                onClick={() => bulkMonitor.mutate(true)}
                disabled={bulkMonitor.isPending}
              >
                Monitor
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => bulkMonitor.mutate(false)}
                disabled={bulkMonitor.isPending}
              >
                Unmonitor
              </button>
              <button type="button" className="secondary" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
              {bulkMessage && (
                <span className="empty-state" style={{ padding: 0 }} role="status">
                  {bulkMessage}
                </span>
              )}
            </div>
          )}

          {items.length > 0 && (
            <div className="form-row" style={{ alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                Select all visible
              </label>
            </div>
          )}

          {items.length ? (
            <div className="artist-list" role="list">
              {items.map((artist) => (
                <ArtistRow
                  key={artist.id}
                  artist={artist}
                  selected={selectedIds.has(artist.id)}
                  expanded={expandedIds.has(artist.id)}
                  onToggleSelect={toggleSelect}
                  onToggleExpand={toggleExpand}
                  onMonitorChange={(id, value) => monitorOne.mutate({ id, monitored: value })}
                />
              ))}
            </div>
          ) : !summary.isLoading ? (
            <p className="empty-state">
              {anyFilterActive ? 'No artists match these filters.' : 'No artists yet.'}
            </p>
          ) : null}

          {totalPages > 1 && (
            <div className="form-row" style={{ alignItems: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span className="empty-state" style={{ padding: 0 }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}

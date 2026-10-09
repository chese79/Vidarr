import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const SOURCE_LABEL: Record<string, string> = { library: 'Your library', lastfm: 'Last.fm', spotify: 'Spotify', musicbrainz: 'MusicBrainz' };
const LETTERS = ['#', ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))];
const artistLetter = (name: string) => {
  const value = name.replace(/^the\s+/i, '').trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(value) ? value : '#';
};

export default function DiscoverPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (typeof location.state?.discoverScroll === "number") {
      const frame = requestAnimationFrame(() => window.scrollTo(0, location.state.discoverScroll));
      return () => cancelAnimationFrame(frame);
    }
  }, [location.state]);
  const [params, setParams] = useSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(location.state?.message ?? null);
  const selected = new Set((params.get('selected') ?? '').split(',').map(Number).filter((id) => id > 0));
  const setSelected = (next: Set<number> | ((current: Set<number>) => Set<number>)) => {
    const ids = typeof next === 'function' ? next(selected) : next;
    const copy = new URLSearchParams(params);
    ids.size ? copy.set('selected', [...ids].join(',')) : copy.delete('selected');
    setParams(copy, { replace: true });
  };
  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const mbQuery = params.get('mbQuery') ?? '';
  const lookup = useQuery({ queryKey: ['discover-musicbrainz', mbQuery], queryFn: () => api.artists.searchMusicbrainz(mbQuery), enabled: Boolean(mbQuery) });
  function review(id: number, collectSources: boolean) {
    navigate(`/artist/${id}`, { state: { discoverReturnTo: `/discover?${params}`, discoverScroll: window.scrollY, collectSources } });
  }
  const addReview = useMutation({
    mutationFn: (mbid: string) => {
      const root = rootFolders.data?.[0]; const profile = qualityProfiles.data?.[0];
      if (!root || !profile) throw new Error('Add a root folder and quality profile first.');
      return api.artists.addMusicbrainz({ musicbrainzArtistId: mbid, rootFolderId: root.id, qualityProfileId: profile.id });
    },
    onSuccess: (artist) => { queryClient.invalidateQueries({ queryKey: ['artists'] }); review(artist.id, false); },
  });
  const recommendations = useQuery({ queryKey: ['recommendations'], queryFn: api.recommendations.list });
  useEffect(() => {
    if (recommendations.isSuccess && typeof location.state?.discoverScroll === 'number') {
      const frame = requestAnimationFrame(() => window.scrollTo(0, location.state.discoverScroll));
      return () => cancelAnimationFrame(frame);
    }
  }, [recommendations.isSuccess, location.state]);
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({ queryKey: ['qualityProfiles'], queryFn: api.qualityProfiles.list });
  const [validation, setValidation] = useState<{ name: string; validated: boolean; sources: string[]; warnings: string[] } | null>(null);
  const [validating, setValidating] = useState(false);
  const createNew = useMutation({
    mutationFn: (data: { name: string; allowUnverified: boolean }) => {
      const root = rootFolders.data?.[0]; const profile = qualityProfiles.data?.[0];
      if (!root || !profile) throw new Error('Add a root folder and quality profile first.');
      return api.artists.addNew({ ...data, rootFolderId: root.id, qualityProfileId: profile.id });
    },
    onSuccess: ({ artist }) => { queryClient.invalidateQueries({ queryKey: ['artists'] }); review(artist.id, false); },
  });
  async function validateAndAdd() {
    const name = value('newArtistName').trim();
    if (!name) return;
    setValidating(true); setValidation(null);
    try {
      const result = await api.artists.validateNew(name);
      setValidation({ name, ...result });
      if (result.validated) await createNew.mutateAsync({ name, allowUnverified: false });
    } catch (error) { setMessage(`Could not add artist: ${(error as Error).message}`); }
    finally { setValidating(false); }
  }
  const all = recommendations.data ?? [];
  const value = (key: string) => params.get(key) ?? '';
  const update = (key: string, next: string) => {
    const copy = new URLSearchParams(params); next ? copy.set(key, next) : copy.delete(key); setParams(copy);
  };
  const search = value('search'); const genre = value('genre'); const match = value('match');
  const source = value('source'); const letter = value('letter');
  const minScore = Number(value('minScore') || 0); const minPlayCount = Number(value('minPlayCount') || 0);
  const genres = useMemo(() => [...new Set(all.flatMap((item) => item.genre?.split(',').map((g) => g.trim()).filter(Boolean) ?? []))].sort(), [all]);
  const availableLetters = useMemo(() => new Set(all.map((item) => artistLetter(item.artistName))), [all]);
  const visible = useMemo(() => all.filter((item) =>
    (!search || item.artistName.toLowerCase().includes(search.toLowerCase())) &&
    (!genre || item.genre?.split(',').some((g) => g.trim().toLowerCase() === genre.toLowerCase())) &&
    (!match || (match === 'matched' ? Boolean(item.mbid) : !item.mbid)) &&
    (!source || item.sourceHits.some((hit) => hit.source === source)) &&
    (!letter || artistLetter(item.artistName) === letter) &&
    item.aggregateScore >= minScore && (item.playCount ?? 0) >= minPlayCount
  ), [all, search, genre, match, source, letter, minScore, minPlayCount]);

  const dismiss = useMutation({ mutationFn: api.recommendations.dismiss, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recommendations'] }) });
  const add = useMutation({
    mutationFn: (id: number) => {
      const rootFolder = rootFolders.data?.[0]; const qualityProfile = qualityProfiles.data?.[0];
      if (!rootFolder || !qualityProfile) throw new Error('Add a root folder and a quality profile first.');
      return api.recommendations.add(id, { rootFolderId: rootFolder.id, qualityProfileId: qualityProfile.id });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recommendations'] }); queryClient.invalidateQueries({ queryKey: ['artists'] }); },
  });
  const canAdd = Boolean(rootFolders.data?.length && qualityProfiles.data?.length);
  const filtersActive = Boolean(search || genre || match || source || letter || minScore || minPlayCount);

  async function refresh() {
    setRefreshing(true); setMessage(null);
    try { const result = await api.recommendations.refresh(); setMessage(`${result.totalRecommendations} recommendations (${result.newRecommendations} new)`); await queryClient.invalidateQueries({ queryKey: ['recommendations'] }); }
    catch (error) { setMessage(`Refresh failed: ${(error as Error).message}`); }
    setRefreshing(false);
  }
  async function bulk(action: 'add' | 'dismiss') {
    for (const id of selected) await (action === 'add' ? add.mutateAsync(id) : dismiss.mutateAsync(id));
    setSelected(new Set());
  }

  return <div>
    <div className="page-header"><h2>Discover</h2><div className="form-row" style={{ marginBottom: 0 }}><button onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh Recommendations'}</button><button className="add-new-artist" onClick={() => update('addNew', value('addNew') ? '' : '1')}>Add New Artist</button></div></div>
    {value('addNew') && <form className="card" aria-label="Add New Artist" onSubmit={(e) => { e.preventDefault(); void validateAndAdd(); }}>
      <div className="form-row"><input aria-label="New artist name" placeholder="Artist name" maxLength={120} required value={value('newArtistName')} onChange={(e) => { update('newArtistName', e.target.value); setValidation(null); }} /><button disabled={!canAdd || validating || createNew.isPending}>{validating ? 'Checking sources…' : 'Validate & Add'}</button></div>
      <p>Checks MusicBrainz, Last.fm and IMVDb. Artists remain unmonitored until you select wanted videos. An artist without a confirmed MusicBrainz identity stays in Artist Review.</p>
      {validation && !validation.validated && validation.name === value('newArtistName').trim() && <div role="alert"><p>No source validated “{validation.name}”. Check the spelling, or add it as an unverified artist for review. {validation.warnings.join(' ')}</p><button type="button" disabled={createNew.isPending} onClick={() => createNew.mutate({ name: validation.name, allowUnverified: true })}>Add unverified artist anyway</button></div>}
      {createNew.isError && <p role="alert">{(createNew.error as Error).message}</p>}
    </form>}
    <section className="card" aria-label="Find an artist to review">
      <div className="form-row">
        <label>Existing artists <select aria-label="Existing artists" value={value('libraryArtist')} onChange={(e) => update('libraryArtist', e.target.value)}><option value="">Choose an artist</option>{artists.data?.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label>
        <button disabled={!value('libraryArtist')} onClick={() => review(Number(value('libraryArtist')), true)}>Review Artist</button>
      </div>
      <form className="form-row" onSubmit={(e) => { e.preventDefault(); update('mbQuery', value('artistSearch').trim()); }}>
        <input aria-label="Search MusicBrainz artists" placeholder="Artist name" maxLength={120} value={value('artistSearch')} onChange={(e) => update('artistSearch', e.target.value)} />
        <button disabled={!value('artistSearch').trim() || lookup.isFetching}>Search MusicBrainz</button>
      </form>
      {lookup.isFetching && <p role="status">Searching MusicBrainz…</p>}
      {lookup.isError && <p role="alert">{(lookup.error as Error).message}</p>}
      {addReview.isError && <p role="alert">{(addReview.error as Error).message}</p>}
      {lookup.isSuccess && !lookup.data.length && <p>No artists found.</p>}
      {lookup.data?.map((artist) => <div className="form-row" key={artist.id}>
        <span>{artist.name} · {[artist.type, artist.country, artist.disambiguation].filter(Boolean).join(' · ')}</span>
        <button disabled={!canAdd || addReview.isPending} onClick={() => addReview.mutate(artist.id)}>Add to Library &amp; Review</button>
      </div>)}
    </section>
    {message && <p className="empty-state" role="status">{message}</p>}
    {(rootFolders.isError || qualityProfiles.isError) && <p className="empty-state" role="alert">Could not load root folders or quality profiles. Check your connection and reload.</p>}
    {rootFolders.isSuccess && qualityProfiles.isSuccess && !canAdd && <p className="empty-state">Add a root folder and a quality profile before you can add recommended artists.</p>}
    {recommendations.isPending ? <p className="empty-state" role="status">Loading recommendations…</p> : recommendations.isError ? <p className="empty-state" role="alert">Could not load recommendations. Check your connection and reload.</p> : <div className="library-layout">
    {all.length > 0 && <nav className="letter-rail" aria-label="Filter recommendations by letter">{LETTERS.map((item) => <button key={item} type="button" disabled={!availableLetters.has(item)} className={letter === item ? 'active' : ''} onClick={() => update('letter', letter === item ? '' : item)}>{item}</button>)}</nav>}
    <div className="library-main">
    <div className="library-filter-bar">
      <input aria-label="Search recommended artists" placeholder="Search artists" value={search} onChange={(e) => update('search', e.target.value)} />
      <select aria-label="Filter recommendation genre" value={genre} onChange={(e) => update('genre', e.target.value)}><option value="">All genres</option>{genres.map((item) => <option key={item}>{item}</option>)}</select>
      <select aria-label="Filter MusicBrainz match" value={match} onChange={(e) => update('match', e.target.value)}><option value="">All match states</option><option value="matched">MusicBrainz matched</option><option value="unmatched">Needs matching</option></select>
      <select aria-label="Filter recommendation source" value={source} onChange={(e) => update('source', e.target.value)}><option value="">All sources</option>{Object.entries(SOURCE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <input type="number" min="0" step="0.1" aria-label="Minimum recommendation score" placeholder="Min score" value={minScore || ''} onChange={(e) => update('minScore', e.target.value)} />
      <input type="number" min="0" aria-label="Minimum artist play count" placeholder="Min plays" value={minPlayCount || ''} onChange={(e) => update('minPlayCount', e.target.value)} />
      {filtersActive && <button className="secondary" onClick={() => setParams({})}>Clear all</button>}
    </div>
    <p>{visible.length} of {all.length} recommendations</p>
    {selected.size > 0 && <div className="bulk-action-bar"><strong>{selected.size} selected</strong><button disabled={!canAdd} onClick={() => bulk('add')}>Add selected</button><button className="secondary" onClick={() => bulk('dismiss')}>Dismiss selected</button></div>}
    {visible.length ? <table><thead><tr><th><input type="checkbox" aria-label="Select visible recommendations" checked={visible.every((item) => selected.has(item.id))} onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((item) => item.id)) : new Set())} /></th><th>Artist</th><th>Score</th><th>Genre</th><th>Why</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {visible.map((item) => <tr key={item.id}><td><input type="checkbox" aria-label={`Select ${item.artistName}`} checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /></td><td>{item.artistName} · {item.mbid ? 'MB matched' : 'needs match'}</td><td>{item.aggregateScore.toFixed(2)}</td><td>{item.genre ?? 'Unknown'}</td><td>{[...new Set(item.sourceHits.map((hit) => SOURCE_LABEL[hit.source] ?? hit.source))].join(', ')}</td><td style={{ display: 'flex', gap: 6 }}><button disabled={!canAdd} onClick={() => add.mutate(item.id)}>Add to Library</button><button className="secondary" onClick={() => dismiss.mutate(item.id)}>Dismiss</button></td></tr>)}
    </tbody></table> : <p className="empty-state">No recommendations match these filters. Sync a connector or refresh recommendation providers.</p>}
    </div></div>}
  </div>;
}

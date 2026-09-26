import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [params, setParams] = useSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const recommendations = useQuery({ queryKey: ['recommendations'], queryFn: api.recommendations.list });
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({ queryKey: ['qualityProfiles'], queryFn: api.qualityProfiles.list });
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
    <div className="page-header"><h2>Discover</h2><button onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh Recommendations'}</button></div>
    {message && <p className="empty-state" role="status">{message}</p>}
    {!canAdd && <p className="empty-state">Add a root folder and a quality profile before you can add recommended artists.</p>}
    <nav className="letter-rail" aria-label="Filter recommendations by letter">{LETTERS.map((item) => <button key={item} type="button" disabled={!availableLetters.has(item)} className={letter === item ? 'active' : ''} onClick={() => update('letter', letter === item ? '' : item)}>{item}</button>)}</nav>
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
  </div>;
}

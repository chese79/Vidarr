import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LivePerformanceDetail } from '@vidarr/shared-types';
import { api } from '../api/client';

export default function LivePerformanceTools({ performance }: { performance: LivePerformanceDetail }) {
  const cache = useQueryClient(), id = performance.id;
  const [evidence, setEvidence] = useState(''), [song, setSong] = useState(''), [guestSearch, setGuestSearch] = useState(''), [guest, setGuest] = useState(''), [guestSong, setGuestSong] = useState('');
  const [occasionSearch, setOccasionSearch] = useState(''), [occasionTitle, setOccasionTitle] = useState('');
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const [reference, setReference] = useState('');
  const guests = useQuery({ queryKey: ['live-guests', guestSearch], queryFn: () => api.live.artists(guestSearch), enabled: guestSearch.length > 1 });
  const occasions = useQuery({ queryKey: ['live-occasions', occasionSearch], queryFn: () => api.live.read<Array<{ id: number; title: string }>>(`occasions?search=${encodeURIComponent(occasionSearch)}`) });
  const action = useMutation({ mutationFn: ({ path, data, method }: { path: string; data: unknown; method?: string }) => api.live.action(path, data, method), onSuccess: () => {
    cache.invalidateQueries({ queryKey: ['live-performance', id] }); cache.invalidateQueries({ queryKey: ['live-performances'] }); cache.invalidateQueries({ queryKey: ['live-occasions'] });
  } });
  const run = (path: string, data: unknown, method?: string) => action.mutate({ path, data, method });
  const reorder = (from: number, to: number) => { const order = performance.songs.map(song => song.id); [order[from], order[to]] = [order[to], order[from]]; run(`performances/${id}/songs/sequence`, { songIds: order }); };
  return <details className="card"><summary>Setlist, credits and occasion</summary>
    <form onSubmit={e => { e.preventDefault(); run(`performances/${id}/link-reference`, { setlistFmId: reference, revision: performance.revision }); }}><label>Link a setlist.fm event ID <input required value={reference} onChange={e => setReference(e.target.value)} placeholder="Event ID from its setlist URL" /></label><p>Linking preserves this local performance, its songs, files and viewing history. Reference date/place differences remain pending review.</p><button disabled={action.isPending}>Fetch and review reference</button></form>
    {action.isError && <p role="alert">{action.error.message}</p>}{action.isSuccess && <p role="status">Saved.</p>}
    {performance.correctionPayload && <section><h4>External correction needs review</h4><p>Your current details and recording associations remain intact. Applying reference metadata does not replace song occurrence IDs or verify changed setlist order.</p><pre style={{ whiteSpace: 'pre-wrap' }}>{performance.correctionPayload}</pre>
      <button onClick={() => run(`performances/${id}/correction`, { revision: performance.revision, action: 'keepUserDetails' })}>Keep my details</button>{' '}<button onClick={() => run(`performances/${id}/correction`, { revision: performance.revision, action: 'applyReferenceMetadata' })}>Apply reference date and place</button></section>}
    <h4>Song order and classification</h4><p>Repeated renditions are separate occurrences. Snippets and medley components do not establish full-song coverage.</p>
    {performance.songs.map((song, index) => <div key={song.id}><span>{song.position}. {song.title}</span>{' '}
      <select aria-label={`Classification for occurrence ${song.position}`} value={song.kind} onChange={e => run(`songs/${song.id}`, { kind: e.target.value }, 'PATCH')}><option value="unknown">Unknown</option><option value="full">Full song</option><option value="snippet">Snippet</option><option value="medleyComponent">Medley component</option></select>{' '}
      <select aria-label={`Style for occurrence ${song.position}`} value={song.style ?? 'unknown'} onChange={e => run(`songs/${song.id}`, { style: e.target.value }, 'PATCH')}><option value="unknown">Style unknown</option><option value="acoustic">Acoustic</option><option value="electric">Electric</option><option value="mixed">Mixed</option></select>{' '}
      <label>MusicBrainz work ID <input key={song.musicbrainzWorkId ?? 'unknown'} defaultValue={song.musicbrainzWorkId ?? ''} placeholder="Optional work UUID" onBlur={e => { if (e.target.value !== (song.musicbrainzWorkId ?? '')) run(`songs/${song.id}`, { musicbrainzWorkId: e.target.value || null }, 'PATCH'); }} /></label>
      <button disabled={!index || action.isPending} aria-label={`Move occurrence ${song.position} up`} onClick={() => reorder(index, index - 1)}>↑</button>{' '}<button disabled={index === performance.songs.length - 1 || action.isPending} aria-label={`Move occurrence ${song.position} down`} onClick={() => reorder(index, index + 1)}>↓</button></div>)}
    <form onSubmit={e => { e.preventDefault(); run(`performances/${id}/songs`, { title: song }); setSong(''); }}><label>Add another song occurrence <input required value={song} onChange={e => setSong(e.target.value)} /></label><button disabled={action.isPending}>Add song</button></form>
    <p>{performance.referenceComplete ? 'Reference setlist verified complete' : 'Reference completeness unverified'}</p>
    <label>Evidence for reference completeness <textarea value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
    <button disabled={!evidence.trim() || action.isPending} onClick={() => run(`performances/${id}/reference`, { revision: performance.revision, complete: !performance.referenceComplete, evidence })}>{performance.referenceComplete ? 'Mark reference incomplete' : 'Confirm reference is complete'}</button>
    <h4>Participating artists</h4>{performance.credits?.map(credit => <p key={credit.id}>{credit.artist.name} · {credit.role}{credit.songId && ' · specific song occurrence'}</p>)}
    <label>Find a confirmed participating artist <input value={guestSearch} onChange={e => setGuestSearch(e.target.value)} /></label>
    <label>Artist <select value={guest} onChange={e => setGuest(e.target.value)}><option value="">Choose artist</option>{guests.data?.items.map(artist => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label>
    <label>Joined song <select value={guestSong} onChange={e => setGuestSong(e.target.value)}><option value="">Whole performance</option>{performance.songs.map(song => <option key={song.id} value={song.id}>{song.position}. {song.title}</option>)}</select></label>
    <button disabled={!guest || action.isPending} onClick={() => run(`performances/${id}/credits`, { artistId: Number(guest), role: 'guest', ...(guestSong ? { songId: Number(guestSong) } : {}) })}>Credit guest without duplicating the performance</button>
    <h4>Concert / festival occasion</h4><p>Opening acts and festival artist sets keep their own ordered performances, linked to one occasion.</p>
    {performance.occasion && <><strong>{performance.occasion.title}</strong>{performance.occasion.performances.map(set => <p key={set.id}><Link to={`/live/performance/${set.id}`}>{set.title}</Link></p>)}</>}
    <label>Find occasion <input value={occasionSearch} onChange={e => setOccasionSearch(e.target.value)} /></label>
    <label>Link an existing occasion <select value={performance.occasion?.id ?? ''} onChange={e => run(`performances/${id}/occasion`, { occasionId: e.target.value ? Number(e.target.value) : null }, 'PATCH')}><option value="">No occasion</option>{occasions.data?.map(occasion => <option key={occasion.id} value={occasion.id}>{occasion.title}</option>)}</select></label>
    <form onSubmit={e => { e.preventDefault(); run('occasions', { title: occasionTitle, performanceIds: [id] }); }}><label>New occasion title <input required value={occasionTitle} onChange={e => setOccasionTitle(e.target.value)} /></label><button disabled={action.isPending}>Create and link occasion</button></form>
    <button disabled={action.isPending} onClick={() => run(`performances/${id}/monitoring`, { excluded: !performance.ignored })}>{performance.ignored ? 'Allow monitoring rules again' : 'Exclude this performance from monitoring'}</button>
    <h4>Remove performance from catalog</h4><p>This never deletes media. Resolve owned recordings, linked candidates and active acquisitions first. Song and viewing history are retained for recovery.</p>
    {performance.removedAt ? <button onClick={() => run(`performances/${id}/restore`, {})}>Restore performance</button> : <>
      <label><input type="checkbox" checked={removeConfirmed} onChange={e => setRemoveConfirmed(e.target.checked)} /> Confirm removing this performance from the visible catalog</label>
      <button disabled={!removeConfirmed || action.isPending} onClick={() => run(`performances/${id}/remove`, { confirmed: true })}>Remove catalog entry</button></>}
  </details>;
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface FlaggedVideo { id: number; title: string; artist: { id: number; name: string }; qualifiedPlayCount: number }
export default function LiveClassificationPage() {
  const cache = useQueryClient(), [offset, setOffset] = useState(0), [selected, setSelected] = useState<FlaggedVideo>();
  const [search, setSearch] = useState(''), [eventId, setEvent] = useState(''), [verified, setVerified] = useState(false);
  const candidates = useQuery({ queryKey: ['live-reclassification', offset], queryFn: () => api.live.read<FlaggedVideo[]>(`reclassification?offset=${offset}`) });
  const events = useQuery({ queryKey: ['live-classify-events', selected?.artist.id, search], queryFn: () => api.live.performances(`artistId=${selected!.artist.id}&search=${encodeURIComponent(search)}`), enabled: !!selected });
  const classify = useMutation({ mutationFn: () => api.live.action<{ id: number }>(`reclassification/${selected!.id}`, { performanceId: Number(eventId), videoVerified: verified }),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['live-reclassification'] }); cache.invalidateQueries({ queryKey: ['artist'] }); setSelected(undefined); setVerified(false); } });
  return <><Link to="/live">Live</Link><h2>Awaiting live classification</h2><p>Flagged videos remain playable in Music Videos until reviewed. Confirmed classification preserves the original file, counts and playlist references and does not start a download.</p>
    {candidates.isError && <p role="alert">{candidates.error.message}</p>}
    {candidates.data?.map(video => <article className="card" key={video.id}><strong>{video.artist.name}: {video.title}</strong><p>{video.qualifiedPlayCount} historical qualified plays retained</p>
      <button onClick={() => { setSelected(video); setEvent(''); setVerified(false); }}>Review classification</button></article>)}
    <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>{' '}<button disabled={(candidates.data?.length ?? 0) < 25} onClick={() => setOffset(offset + 25)}>Next</button>
    {selected && <section className="card"><h3>{selected.title}</h3><p>Choose the actual performance. If none exists, <Link to={`/artist/${selected.artist.id}/live`}>create an independent performance</Link> with known details and return here.</p>
      <label>Find performance <input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Performance <select value={eventId} onChange={e => setEvent(e.target.value)}><option value="">Choose reviewed event</option>{events.data?.items.map(event => <option key={event.id} value={event.id}>{event.performanceDate ?? 'Date unknown'} · {event.title} · {event.venue}</option>)}</select></label>
      <label><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified the performer, event identity and moving video</label>
      <button disabled={!verified || !eventId || classify.isPending} onClick={() => classify.mutate()}>Confirm classification</button>
      {classify.isError && <p role="alert">{classify.error.message}</p>}
    </section>}
    {classify.isSuccess && <p role="status">Classification saved. <Link to={`/live/recording/${classify.data.id}`}>Open recording</Link>.</p>}
  </>;
}

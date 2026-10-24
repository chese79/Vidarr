import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ActionButton } from './ButtonFeedback';

interface Item { id: number; kind: string; title: string; url: string }
interface Page { enabled: boolean; total: number; items: Item[]; artist: { liveDiscoveryStatus: string; liveDiscoveryError: string | null; videoInventoryStatus: string; videoInventoryError: string | null } }

export function LiveStartingArtists() {
  const refreshStatus = useQuery({ queryKey: ['existing-artist-discovery'], queryFn: () => api.live.read<{ status: string; total: number; attempted: number; failed: number; currentArtist: string | null }>('source-refresh-status'), refetchInterval: query => query.state.data?.status === 'running' ? 5000 : false });
  const ready = useQuery({ queryKey: ['live-start-artists'], queryFn: () => api.live.read<{ enabled: boolean; items: Array<{ id: number; name: string; _count: { liveDiscoveryItems: number } }> }>('start'), refetchInterval: query => query.state.data?.items.length ? false : 5000 });
  const prepare = useMutation({ mutationFn: () => api.live.action('start/prepare', {}) });
  const enabled = ready.data?.enabled === true;
  useEffect(() => { if (enabled) prepare.mutate(); }, [enabled]);
  if (!enabled) return null;
  return <section className="card"><h3>Start exploring Live</h3><p>Open an artist with discovered videos or promising MusicBrainz Live references. Suggestions are not missing-video obligations.</p>
    {!!refreshStatus.data?.total && <p role="status">Existing artist discovery: {refreshStatus.data.attempted} / {refreshStatus.data.total} checked · {refreshStatus.data.failed} need retry{refreshStatus.data.currentArtist ? ` · Checking ${refreshStatus.data.currentArtist}` : ''} · {refreshStatus.data.status}</p>}
    {ready.data?.items.map(artist => <p key={artist.id}><Link to={`/artist/${artist.id}/live`}>{artist.name}</Link> · {artist._count.liveDiscoveryItems} discoveries to explore</p>)}
    {!ready.data?.items.length && <p role="status">Preparing starting points in the background. You can also open any artist below. setlist.fm is only checked when requested.</p>}
    {[ready.error, prepare.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}
  </section>;
}

export default function LiveStartingView({ artistId }: { artistId: number }) {
  const cache = useQueryClient(), navigate = useNavigate();
  const [videoOffset, setVideoOffset] = useState(0), [referenceOffset, setReferenceOffset] = useState(0);
  const poll = (query: { state: { data?: Page } }) => ['pending', 'running'].includes(query.state.data?.artist?.liveDiscoveryStatus ?? '') || query.state.data?.artist?.videoInventoryStatus === 'running' ? 3000 : false;
  const videos = useQuery({ queryKey: ['live-start', artistId, 'video', videoOffset], queryFn: () => api.live.read<Page>(`artists/${artistId}/start?kind=video&offset=${videoOffset}`), refetchInterval: poll });
  const references = useQuery({ queryKey: ['live-start', artistId, 'reference', referenceOffset], queryFn: () => api.live.read<Page>(`artists/${artistId}/start?kind=reference&offset=${referenceOffset}`), refetchInterval: poll });
  const refresh = () => cache.invalidateQueries({ queryKey: ['live-start', artistId] });
  const prepare = useMutation({ mutationFn: (refreshSources: boolean) => api.live.action(`artists/${artistId}/prepare`, { refresh: refreshSources }), onSuccess: refresh });
  const enabled = videos.data?.enabled === true;
  useEffect(() => { if (enabled) prepare.mutate(false); }, [artistId, enabled]);
  const open = useMutation({ mutationFn: (item: Item) => api.live.action<{ recordingId?: number; performanceId: number }>(`artists/${artistId}/start/${item.id}/open`, {}), onSuccess: result => { refresh(); navigate(result.recordingId ? `/live/recording/${result.recordingId}` : `/live/performance/${result.performanceId}`); } });
  const dismiss = useMutation({ mutationFn: (item: Item) => api.live.action(`artists/${artistId}/start/${item.id}`, { dismissed: true }, 'PATCH'), onSuccess: () => { setVideoOffset(0); setReferenceOffset(0); refresh(); } });
  const state = videos.data?.artist;
  if (videos.isPending) return <p role="status">Loading Live starting points…</p>;
  if (videos.data && !enabled) return <p role="status">Live &amp; Concerts is disabled or unavailable. <Link to="/settings">Open General settings</Link>. Saved data is retained.</p>;
  return <section className="live-starting-view"><p>Start with a discovered video or a short list of promising performances. Discoveries stay available regardless of the catalog view.</p>
    {state && <p role="status">{state.liveDiscoveryStatus === 'running' || state.videoInventoryStatus === 'running' ? 'Collecting artist sources; results appear as they are found.' : state.liveDiscoveryStatus === 'pending' ? 'Preparing starting points…' : state.liveDiscoveryStatus === 'partial' ? 'Some sources could not be checked. Earlier discoveries are retained.' : 'Artist starting points checked.'}</p>}
    <ActionButton disabled={prepare.isPending || state?.videoInventoryStatus === 'running'} onClick={() => prepare.mutate(true)}>Refresh artist sources</ActionButton>
    {([['Videos found', videos.data, videoOffset, setVideoOffset], ['Suggested performances to search', references.data, referenceOffset, setReferenceOffset]] as const).map(([heading, page, offset, setOffset]) => <section className="card" key={heading}>
      <h3>{heading}</h3><p>{heading === 'Videos found' ? 'Review the artist and actual moving video before downloading. Unknown event details do not discard an upload.' : 'Five ranked MusicBrainz Live releases, broadcasts or event leads at a time. A reference is a search lead, not proof of a video. Release dates are not performance dates.'}</p>
      {!page?.items.length && <p>{heading === 'Videos found' ? 'No live upload candidates found yet.' : 'No strong Live references found yet.'} {state?.liveDiscoveryStatus === 'running' ? 'Collection is still running.' : 'Refresh artist sources or explore setlist.fm explicitly below.'}</p>}
      {page?.items.map(item => <article className="live-start-item" key={item.id}><h4>{item.title}</h4><p><a href={item.url} target="_blank" rel="noreferrer">{item.kind === 'video' ? 'Open upload' : 'MusicBrainz reference'}</a></p>
        <ActionButton disabled={open.isPending} onClick={() => open.mutate(item)}>{item.kind === 'video' ? 'Review video for download' : 'Open performance search'}</ActionButton>{' '}
        <ActionButton className="secondary" disabled={dismiss.isPending} onClick={() => dismiss.mutate(item)}>Dismiss suggestion</ActionButton>
      </article>)}
      {page && page.total > 5 && <p><ActionButton disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 5))}>Previous suggestions</ActionButton>{' '}<ActionButton disabled={offset + 5 >= page.total} onClick={() => setOffset(offset + 5)}>Explore more suggestions</ActionButton> · {offset + 1}–{Math.min(offset + 5, page.total)} of {page.total}</p>}
    </section>)}
    {state?.liveDiscoveryError && <p role="alert">{state.liveDiscoveryError}</p>}{state?.videoInventoryError && <p role="alert">Artist sources: {state.videoInventoryError}</p>}
    {[videos.error, references.error, prepare.error, open.error, dismiss.error].filter(Boolean).map((error, index) => <p role="alert" key={index}>{error?.message}</p>)}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ActionButton } from './ButtonFeedback';

interface Item { id: number; kind: string; title: string; url: string; provider?: string; evidence?: string; createdAt?: string; recordingId?: number | null; performanceId?: number | null }
interface Page { enabled: boolean; total: number; items: Item[]; artist: { liveDiscoveryStatus: string; liveDiscoveryError: string | null; videoInventoryStatus: string; videoInventoryError: string | null } }
const PAGE_SIZE = 25;
const providerLabel = (item: Item) => item.provider === 'musicbrainz-event' ? 'MusicBrainz event' : item.kind === 'video' ? 'YouTube' : 'MusicBrainz';
function publicationDate(item: Item): string | null {
  try {
    const date = JSON.parse(item.evidence ?? '{}').publicationDate;
    return typeof date === 'string' && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString() : null;
  } catch { return null; }
}

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
  const preparedArtist = useRef<number | null>(null);
  const [videoOffset, setVideoOffset] = useState(0), [referenceOffset, setReferenceOffset] = useState(0);
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => { setDebouncedSearch(search); setVideoOffset(0); setReferenceOffset(0); setExpanded(null); }, 250);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);
  const poll = (query: { state: { data?: Page } }) => ['pending', 'running'].includes(query.state.data?.artist?.liveDiscoveryStatus ?? '') || query.state.data?.artist?.videoInventoryStatus === 'running' ? 3000 : false;
  const query = (kind: string, offset: number) => `artists/${artistId}/start?${new URLSearchParams({ kind, offset: String(offset), limit: String(PAGE_SIZE), search: debouncedSearch })}`;
  const videos = useQuery({ queryKey: ['live-start', artistId, 'video', videoOffset, debouncedSearch], queryFn: () => api.live.read<Page>(query('video', videoOffset)), refetchInterval: poll });
  const references = useQuery({ queryKey: ['live-start', artistId, 'reference', referenceOffset, debouncedSearch], queryFn: () => api.live.read<Page>(query('reference', referenceOffset)), refetchInterval: poll });
  const refresh = () => cache.invalidateQueries({ queryKey: ['live-start', artistId] });
  const prepare = useMutation({ mutationFn: (refreshSources: boolean) => api.live.action(`artists/${artistId}/prepare`, { refresh: refreshSources }), onSuccess: refresh });
  const enabled = videos.data?.enabled === true;
  useEffect(() => {
    if (enabled && preparedArtist.current !== artistId) { preparedArtist.current = artistId; prepare.mutate(false); }
  }, [artistId, enabled]);
  const open = useMutation({ mutationFn: (item: Item) => api.live.action<{ recordingId?: number; performanceId: number }>(`artists/${artistId}/start/${item.id}/open`, {}), onSuccess: result => { refresh(); navigate(result.recordingId ? `/live/recording/${result.recordingId}` : `/live/performance/${result.performanceId}`); } });
  const dismiss = useMutation({ mutationFn: (item: Item) => api.live.action(`artists/${artistId}/start/${item.id}`, { dismissed: true }, 'PATCH'), onSuccess: () => { setVideoOffset(0); setReferenceOffset(0); refresh(); } });
  const state = videos.data?.artist;
  if (videos.data && !enabled) return <p role="status">Live &amp; Concerts is disabled or unavailable. <Link to="/settings">Open General settings</Link>. Saved data is retained.</p>;
  return <section className="live-starting-view"><p>Start with a discovered video or a short list of promising performances. Discoveries stay available regardless of the catalog view.</p>
    {state && <p role="status">{state.liveDiscoveryStatus === 'running' || state.videoInventoryStatus === 'running' ? 'Collecting artist sources; results appear as they are found.' : state.liveDiscoveryStatus === 'pending' ? 'Preparing starting points…' : state.liveDiscoveryStatus === 'partial' ? 'Some sources could not be checked. Earlier discoveries are retained.' : 'Artist starting points checked.'}</p>}
    <ActionButton disabled={!enabled || prepare.isPending || state?.videoInventoryStatus === 'running'} onClick={() => prepare.mutate(true)}>Refresh artist sources</ActionButton>
    <div className="library-filter-bar"><input aria-label="Search Live discovery candidates" placeholder="Search Live candidates" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></div>
    {([['Videos found', videos, videoOffset, setVideoOffset], ['Suggested performances to search', references, referenceOffset, setReferenceOffset]] as const).map(([heading, result, offset, setOffset]) => <section key={heading} aria-label={heading}>
      <div className="page-header"><h3>{heading}</h3>{result.data && <span className="library-result-count">{result.data.total} {heading === 'Videos found' ? 'video candidates' : 'reference candidates'}</span>}</div>
      <p className="artist-meta">{heading === 'Videos found' ? 'Review the artist and actual moving video before downloading. Unknown event details do not discard an upload.' : 'Ranked MusicBrainz Live releases, broadcasts or event leads. A reference is a search lead, not proof of a video. Release dates are not performance dates.'}</p>
      {result.isPending && <p role="status">Loading Live candidates…</p>}
      {result.isError && <p role="alert">Could not load {heading === 'Videos found' ? 'video' : 'reference'} candidates. <ActionButton className="secondary" onClick={() => result.refetch()}>Retry candidates</ActionButton></p>}
      {result.isSuccess && !result.data.items.length && <p className="empty-state">{debouncedSearch ? 'No Live candidates match this search.' : heading === 'Videos found' ? 'No live upload candidates found yet.' : 'No strong Live references found yet.'} {state?.liveDiscoveryStatus === 'running' ? 'Collection is still running.' : ''}</p>}
      <div className="artist-list" role="list">{result.data?.items.map(item => <div className="artist-row" role="listitem" key={item.id}>
        <div className="artist-row-header">
          <div className="artist-image" aria-hidden="true">{item.kind === 'video' ? '▶' : '♫'}</div>
          <div className="artist-row-main"><span className="artist-name">{item.title}</span><span className="artist-meta">{providerLabel(item)} · {item.kind === 'video' ? 'Live video candidate' : 'Performance search lead'}</span></div>
          <span className="status-chip">{item.recordingId ? 'Review started' : item.performanceId ? 'Search opened' : 'Needs review'}</span>
          <div className="artist-row-actions"><ActionButton className="secondary" aria-expanded={expanded === item.id} aria-controls={`live-candidate-${item.id}`} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? 'Hide details' : 'Review candidate'}</ActionButton></div>
        </div>
        {expanded === item.id && <div id={`live-candidate-${item.id}`} className="artist-accordion" role="region" aria-label={`Review ${item.title}`}>
          {item.createdAt && <p className="artist-meta">First discovered {new Date(item.createdAt).toLocaleDateString()}</p>}
          {publicationDate(item) && <p className="artist-meta">YouTube published {publicationDate(item)} · performance date unconfirmed</p>}
          <p><a href={item.url} target="_blank" rel="noopener noreferrer">{item.kind === 'video' ? 'Inspect source video' : 'MusicBrainz reference'}</a></p>
          <p className="artist-meta">{item.kind === 'video' ? 'Confirm the performer, occasion and moving video in Live review before acquisition.' : 'Open this lead to search for a recording. A release or event reference does not establish video availability.'}</p>
          <div className="form-row"><ActionButton disabled={open.isPending} onClick={() => open.mutate(item)}>{item.kind === 'video' ? 'Review video for download' : 'Open performance search'}</ActionButton>
            <ActionButton className="secondary" disabled={dismiss.isPending} onClick={() => dismiss.mutate(item)}>Dismiss suggestion</ActionButton></div>
        </div>}
      </div>)}</div>
      {result.data && result.data.total > PAGE_SIZE && <div className="review-pagination"><ActionButton className="secondary" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setExpanded(null); }}>Previous suggestions</ActionButton><span className="artist-meta">{offset + 1}–{Math.min(offset + PAGE_SIZE, result.data.total)} of {result.data.total}</span><ActionButton className="secondary" disabled={offset + PAGE_SIZE >= result.data.total} onClick={() => { setOffset(offset + PAGE_SIZE); setExpanded(null); }}>Explore more suggestions</ActionButton></div>}
    </section>)}
    {state?.liveDiscoveryError && <p role="alert">{state.liveDiscoveryError}</p>}{state?.videoInventoryError && <p role="alert">Artist sources: {state.videoInventoryError}</p>}
    {[videos.error, references.error, prepare.error, open.error, dismiss.error].filter(Boolean).map((error, index) => <p role="alert" key={index}>{error?.message}</p>)}
  </section>;
}

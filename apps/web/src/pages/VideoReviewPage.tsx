import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function VideoReviewPage() {
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const artistId = Number(searchParams.get('artistId')) || undefined;
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reassigning, setReassigning] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const candidates = useQuery({
    queryKey: ['video-review-page', artistId, debouncedSearch, page],
    queryFn: () => api.videoReview.page({ artistId, search: debouncedSearch, offset: page * 50, limit: 50 }),
  });
  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const [edits, setEdits] = useState<Record<number, { artistId: number; title: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const scan = useMutation({
    mutationFn: api.videoReview.scanLocal,
    onSuccess: (result) => { setMessage(`Scanned ${result.scanned} local videos; ${result.pending} need review.`); client.invalidateQueries({ queryKey: ['video-review-page'] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const approve = useMutation({
    mutationFn: ({ id, artistId, title }: { id: number; artistId: number; title: string }) => api.videoReview.approve(id, artistId, title),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['video-review-page'] }); client.invalidateQueries({ queryKey: ['artistSummary'] }); setMessage('Music video added to Library.'); },
    onError: (error: Error) => setMessage(error.message),
  });
  const reject = useMutation({
    mutationFn: api.videoReview.reject,
    onSuccess: () => client.invalidateQueries({ queryKey: ['video-review-page'] }),
    onError: (error: Error) => setMessage(error.message),
  });
  const visible = candidates.data?.items ?? [];

  return <div>
    <div className="page-header"><h2>Video Review</h2><button onClick={() => scan.mutate()} disabled={scan.isPending}>{scan.isPending ? 'Scanning…' : 'Scan local videos'}</button></div>
    <p className="empty-state">Only official song music videos belong in Library. Reject interviews, live footage, lyric videos, visualizers, and audio uploads. Resolve the artist in <Link to="/match-review">Match Review</Link> first.</p>
    {message && <p role="status" className="empty-state">{message}</p>}
    <div className="library-filter-bar"><input aria-label="Search video candidates" placeholder="Search candidates" value={search} onChange={(event) => setSearch(event.target.value)} />
      {candidates.data && <span className="library-result-count">{candidates.data.total} pending videos</span>}
    </div>
    {artistId && <p className="empty-state">Showing candidates for {artists.data?.find((artist) => artist.id === artistId)?.name ?? 'this artist'} · <Link to="/video-review">Show all artists</Link></p>}
    {candidates.isPending && <p role="status">Loading video candidates…</p>}
    {candidates.isError && <p role="alert">Could not load video candidates.</p>}
    {candidates.isSuccess && visible.length === 0 && <p className="empty-state">No pending videos match this search.</p>}
    <div className="artist-list" role="list">{visible.map((candidate) => {
      const edit = edits[candidate.id] ?? { artistId: candidate.artistId ?? 0, title: candidate.title };
      return <div className="artist-row" role="listitem" key={candidate.id}>
        <div className="artist-row-header">
          <div className="artist-image" aria-hidden="true">{candidate.source === 'local' ? '⌂' : '▶'}</div>
          <div className="artist-row-main"><span className="artist-name">{candidate.title}</span><span className="artist-meta">{candidate.artistName} · {candidate.source} · {candidate.reason}</span></div>
          <div className="artist-row-actions"><button className="secondary" aria-expanded={expanded === candidate.id} onClick={() => setExpanded(expanded === candidate.id ? null : candidate.id)}>{expanded === candidate.id ? 'Hide details' : 'Review video'}</button></div>
        </div>
        {expanded === candidate.id && <div className="artist-accordion" role="region" aria-label={`Review ${candidate.title}`}>
        <p className="empty-state">First seen {new Date(candidate.firstSeenAt).toLocaleDateString()}
          {candidate.lastSeenAt && ` · Last seen ${new Date(candidate.lastSeenAt).toLocaleDateString()}`}
          {candidate.sourcePublishedAt && ` · YouTube published ${new Date(candidate.sourcePublishedAt).toLocaleDateString()}`}</p>
        {candidate.url && <p><a href={candidate.url} target="_blank" rel="noopener noreferrer">Inspect source video</a></p>}
        {candidate.filePath && <p className="empty-state">{candidate.filePath}</p>}
        <div className="form-row">
          {edit.artistId && !reassigning.has(candidate.id) ? <span>{artists.data?.find((artist) => artist.id === edit.artistId)?.name ?? candidate.artistName} <button className="secondary" onClick={() => setReassigning((current) => new Set(current).add(candidate.id))}>Change artist</button></span> : <select aria-label={`Artist for ${candidate.title}`} value={edit.artistId} onChange={(event) => setEdits({ ...edits, [candidate.id]: { ...edit, artistId: Number(event.target.value) } })}>
            <option value={0}>Choose confirmed artist</option>
            {artists.data?.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
          </select>}
          <input aria-label={`Song title for ${candidate.title}`} value={edit.title} onChange={(event) => setEdits({ ...edits, [candidate.id]: { ...edit, title: event.target.value } })} />
          <button disabled={!edit.artistId || !edit.title.trim() || approve.isPending} onClick={() => approve.mutate({ id: candidate.id, ...edit })}>Approve song video</button>
          <button className="secondary" disabled={reject.isPending} onClick={() => reject.mutate(candidate.id)}>Reject</button>
        </div>
        </div>}
      </div>;
    })}</div>
    {candidates.isSuccess && candidates.data.total > 50 && <div className="review-pagination">
      <button className="secondary" disabled={page === 0} onClick={() => { setPage((value) => value - 1); setExpanded(null); }}>Previous</button>
      <span className="artist-meta">Page {page + 1} of {Math.ceil(candidates.data.total / 50)}</span>
      <button className="secondary" disabled={(page + 1) * 50 >= candidates.data.total} onClick={() => { setPage((value) => value + 1); setExpanded(null); }}>Next</button>
    </div>}
  </div>;
}

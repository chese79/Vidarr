import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function VideoReviewPage() {
  const client = useQueryClient();
  const candidates = useQuery({ queryKey: ['video-review'], queryFn: api.videoReview.list });
  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const [edits, setEdits] = useState<Record<number, { artistId: number; title: string }>>({});
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const scan = useMutation({
    mutationFn: api.videoReview.scanLocal,
    onSuccess: (result) => { setMessage(`Scanned ${result.scanned} local videos; ${result.pending} need review.`); client.invalidateQueries({ queryKey: ['video-review'] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const approve = useMutation({
    mutationFn: ({ id, artistId, title }: { id: number; artistId: number; title: string }) => api.videoReview.approve(id, artistId, title),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['video-review'] }); client.invalidateQueries({ queryKey: ['artistSummary'] }); setMessage('Music video added to Library.'); },
    onError: (error: Error) => setMessage(error.message),
  });
  const reject = useMutation({
    mutationFn: api.videoReview.reject,
    onSuccess: () => client.invalidateQueries({ queryKey: ['video-review'] }),
    onError: (error: Error) => setMessage(error.message),
  });
  const visible = candidates.data?.filter((candidate) =>
    `${candidate.artistName} ${candidate.title}`.toLowerCase().includes(search.toLowerCase())) ?? [];

  return <div>
    <div className="page-header"><h2>Video Review</h2><button onClick={() => scan.mutate()} disabled={scan.isPending}>{scan.isPending ? 'Scanning…' : 'Scan local videos'}</button></div>
    <p className="empty-state">Only official song music videos belong in Library. Reject interviews, live footage, lyric videos, visualizers, and audio uploads. Resolve the artist in <Link to="/match-review">Match Review</Link> first.</p>
    {message && <p role="status" className="empty-state">{message}</p>}
    <input aria-label="Search video candidates" placeholder="Search candidates" value={search} onChange={(event) => setSearch(event.target.value)} />
    {candidates.isPending && <p role="status">Loading video candidates…</p>}
    {candidates.isError && <p role="alert">Could not load video candidates.</p>}
    {candidates.isSuccess && visible.length === 0 && <p className="empty-state">No pending videos match this search.</p>}
    {visible.map((candidate) => {
      const edit = edits[candidate.id] ?? { artistId: candidate.artistId ?? 0, title: candidate.title };
      return <section className="card" key={candidate.id}>
        <h3>{candidate.title}</h3>
        <p className="empty-state">{candidate.source} · observed artist: {candidate.artistName} · {candidate.reason}</p>
        {candidate.url && <p><a href={candidate.url} target="_blank" rel="noopener noreferrer">Inspect source video</a></p>}
        {candidate.filePath && <p className="empty-state">{candidate.filePath}</p>}
        <div className="form-row">
          <select aria-label={`Artist for ${candidate.title}`} value={edit.artistId} onChange={(event) => setEdits({ ...edits, [candidate.id]: { ...edit, artistId: Number(event.target.value) } })}>
            <option value={0}>Choose confirmed artist</option>
            {artists.data?.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
          </select>
          <input aria-label={`Song title for ${candidate.title}`} value={edit.title} onChange={(event) => setEdits({ ...edits, [candidate.id]: { ...edit, title: event.target.value } })} />
          <button disabled={!edit.artistId || !edit.title.trim() || approve.isPending} onClick={() => approve.mutate({ id: candidate.id, ...edit })}>Approve song video</button>
          <button className="secondary" disabled={reject.isPending} onClick={() => reject.mutate(candidate.id)}>Reject</button>
        </div>
      </section>;
    })}
  </div>;
}

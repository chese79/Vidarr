import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const PAGE_SIZE = 25;

export default function MatchReviewPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [searchTerms, setSearchTerms] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(0); setExpanded(null); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const review = useQuery({
    queryKey: ['artist-match-review', debouncedSearch, page],
    queryFn: () => api.artists.matchReviewPage({ search: debouncedSearch, offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
  });
  const discover = useMutation({
    mutationFn: (id: number) => api.artists.discoverMusicbrainzCandidates(id, searchTerms[id]),
    onSuccess: () => client.invalidateQueries({ queryKey: ['artist-match-review'] }),
    onError: (error: Error) => setMessage(error.message),
  });
  const confirm = useMutation({
    mutationFn: ({ id, mbid }: { id: number; mbid: string }) => api.artists.confirmMusicbrainz(id, mbid),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['artist-match-review'] });
      client.invalidateQueries({ queryKey: ['artists'] });
      client.invalidateQueries({ queryKey: ['artistSummary'] });
      setMessage('Artist moved to Library.');
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return <div>
    <div className="page-header"><h2>Match Review</h2></div>
    <p className="empty-state">Audio and video observations stay here until you confirm their MusicBrainz artist. Channel names are hints, not artist identities.</p>
    {message && <p role="status" className="empty-state">{message}</p>}
    <div className="library-filter-bar">
      <input aria-label="Search artist observations" placeholder="Search artists" value={search} onChange={(event) => setSearch(event.target.value)} />
      {review.data && <span className="library-result-count">{review.data.total} artists awaiting review</span>}
    </div>
    {review.isPending && <p role="status">Loading artist observations…</p>}
    {review.isError && <p role="alert">Could not load artist observations.</p>}
    {review.isSuccess && review.data.items.length === 0 && <p className="empty-state">No artists match this search.</p>}
    <div className="artist-list" role="list">
      {review.data?.items.map((artist) => <div className="artist-row" role="listitem" key={artist.id}>
        <div className="artist-row-header">
          <div className="artist-image" aria-hidden="true">{artist.name.slice(0, 1).toUpperCase()}</div>
          <div className="artist-row-main"><span className="artist-name">{artist.name}</span><span className="artist-meta">{artist.musicbrainzMatchStatus} · {artist.musicbrainzCandidates.length} suggested matches</span></div>
          <div className="artist-row-actions"><button className="secondary" aria-expanded={expanded === artist.id} onClick={() => setExpanded(expanded === artist.id ? null : artist.id)}>{expanded === artist.id ? 'Hide matches' : 'Review matches'}</button></div>
        </div>
        {expanded === artist.id && <div className="artist-accordion" role="region" aria-label={`MusicBrainz matches for ${artist.name}`}>
          <form className="review-detail-row" onSubmit={(event) => { event.preventDefault(); discover.mutate(artist.id); }}>
            <input aria-label={`MusicBrainz search name for ${artist.name}`} placeholder="Search name (e.g. Amy Winehouse)" value={searchTerms[artist.id] ?? artist.name} onChange={(event) => setSearchTerms({ ...searchTerms, [artist.id]: event.target.value })} />
            <button className="secondary" type="submit" disabled={discover.isPending}>Find MusicBrainz matches</button>
          </form>
          {artist.musicbrainzCandidates.length === 0 && <span className="artist-meta">No suggested matches yet.</span>}
          {artist.musicbrainzCandidates.map((candidate) => <div className="review-detail-row" key={candidate.id}>
            <strong>{candidate.name}</strong><span className="artist-meta">{candidate.disambiguation || 'No disambiguation'} · {Math.round(candidate.score * 100)}%</span>
            <button onClick={() => confirm.mutate({ id: artist.id, mbid: candidate.musicbrainzArtistId })} disabled={confirm.isPending}>Confirm artist</button>
          </div>)}
        </div>}
      </div>)}
    </div>
    {review.isSuccess && review.data.total > PAGE_SIZE && <div className="review-pagination">
      <button className="secondary" disabled={page === 0} onClick={() => { setPage(page - 1); setExpanded(null); }}>Previous</button>
      <span className="artist-meta">Page {page + 1} of {Math.ceil(review.data.total / PAGE_SIZE)}</span>
      <button className="secondary" disabled={(page + 1) * PAGE_SIZE >= review.data.total} onClick={() => { setPage(page + 1); setExpanded(null); }}>Next</button>
    </div>}
  </div>;
}

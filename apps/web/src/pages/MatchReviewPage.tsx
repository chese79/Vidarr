import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function MatchReviewPage() {
  const client = useQueryClient();
  const review = useQuery({ queryKey: ['artist-match-review'], queryFn: api.artists.matchReview });
  const [message, setMessage] = useState<string | null>(null);
  const discover = useMutation({
    mutationFn: (id: number) => api.artists.discoverMusicbrainzCandidates(id),
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
    {review.isPending && <p role="status">Loading artist observations…</p>}
    {review.isError && <p role="alert">Could not load artist observations.</p>}
    {review.isSuccess && review.data.length === 0 && <p className="empty-state">No artists need matching.</p>}
    {review.data?.map((artist) => <section className="card" key={artist.id}>
      <div className="page-header"><div><h3>{artist.name}</h3><p className="empty-state">{artist.musicbrainzMatchStatus} · awaiting identity confirmation</p></div><button className="secondary" onClick={() => discover.mutate(artist.id)} disabled={discover.isPending}>Find MusicBrainz matches</button></div>
      {artist.musicbrainzCandidates.map((candidate) => <div className="form-row" key={candidate.id}>
        <strong>{candidate.name}</strong><span>{candidate.disambiguation || 'No disambiguation'} · {Math.round(candidate.score * 100)}%</span>
        <button onClick={() => confirm.mutate({ id: artist.id, mbid: candidate.musicbrainzArtistId })} disabled={confirm.isPending}>Confirm artist</button>
      </div>)}
    </section>)}
  </div>;
}

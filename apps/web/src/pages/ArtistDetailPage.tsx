import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function ArtistDetailPage() {
  const { id } = useParams();
  const artistId = Number(id);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [releaseYear, setReleaseYear] = useState('');

  const artist = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => api.artists.get(artistId),
  });

  const createVideo = useMutation({
    mutationFn: api.musicVideos.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      setShowAdd(false);
      setTitle('');
      setReleaseYear('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title) return;
    createVideo.mutate({
      artistId,
      title,
      monitored: true,
      releaseYear: releaseYear ? Number(releaseYear) : undefined,
    });
  }

  if (artist.isLoading) return <p>Loading…</p>;
  if (!artist.data) return <p>Artist not found.</p>;

  return (
    <div>
      <div className="page-header">
        <h2>{artist.data.name}</h2>
        <button onClick={() => setShowAdd((v) => !v)}>Add Video</button>
      </div>

      {showAdd && (
        <form className="card" onSubmit={handleSubmit}>
          <div className="form-row">
            <input
              placeholder="Video title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <input
              placeholder="Year"
              type="number"
              value={releaseYear}
              onChange={(e) => setReleaseYear(e.target.value)}
            />
            <button type="submit">Save</button>
          </div>
        </form>
      )}

      {artist.data.musicVideos.length ? (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Year</th>
              <th>Monitored</th>
              <th>Has File</th>
            </tr>
          </thead>
          <tbody>
            {artist.data.musicVideos.map((mv) => (
              <tr key={mv.id}>
                <td>{mv.title}</td>
                <td>{mv.releaseYear ?? '—'}</td>
                <td>{mv.monitored ? 'Yes' : 'No'}</td>
                <td>{mv.hasFile ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No music videos yet.</p>
      )}
    </div>
  );
}

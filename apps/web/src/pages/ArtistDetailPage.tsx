import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { YoutubeSourceType } from '@vidarr/shared-types';

function YoutubeSourcesSection({ artistId }: { artistId: number }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<YoutubeSourceType>('channel');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Record<number, string>>({});

  const sources = useQuery({
    queryKey: ['youtubeSources', artistId],
    queryFn: () => api.youtubeSources.list(artistId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['youtubeSources', artistId] });
    queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
  };

  const createSource = useMutation({
    mutationFn: api.youtubeSources.create,
    onSuccess: () => {
      invalidate();
      setUrl('');
    },
  });

  const removeSource = useMutation({
    mutationFn: api.youtubeSources.remove,
    onSuccess: invalidate,
  });

  async function handleSync(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Syncing…' }));
    try {
      const result = await api.youtubeSources.sync(id);
      setStatus((s) => ({
        ...s,
        [id]: `${result.matched} matched, ${result.created} new`,
      }));
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>YouTube Sources</h3>
      <form
        className="form-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url) return;
          createSource.mutate({ artistId, type, url, monitored: true });
        }}
      >
        <select value={type} onChange={(e) => setType(e.target.value as YoutubeSourceType)}>
          <option value="channel">Channel</option>
          <option value="playlist">Playlist</option>
          <option value="single_video">Single video</option>
        </select>
        <input
          placeholder="YouTube URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ minWidth: 320 }}
          required
        />
        <button type="submit">Add</button>
      </form>

      {sources.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>URL</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.data.map((s) => (
              <tr key={s.id}>
                <td>{s.type}</td>
                <td>{s.url}</td>
                <td>{status[s.id] ?? (s.lastPolledAt ? 'Synced' : 'Never synced')}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="secondary" onClick={() => handleSync(s.id)}>
                    Sync
                  </button>
                  <button className="secondary" onClick={() => removeSource.mutate(s.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No YouTube sources yet.</p>
      )}
    </div>
  );
}

export default function ArtistDetailPage() {
  const { id } = useParams();
  const artistId = Number(id);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [grabStatus, setGrabStatus] = useState<Record<number, string>>({});

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

  async function handleGrab(videoId: number) {
    setGrabStatus((s) => ({ ...s, [videoId]: 'Downloading…' }));
    const result = await api.musicVideos.grab(videoId);
    setGrabStatus((s) => ({
      ...s,
      [videoId]: result.ok ? 'Done' : `Failed: ${result.error}`,
    }));
    queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {artist.data.musicVideos.map((mv) => (
              <tr key={mv.id}>
                <td>{mv.title}</td>
                <td>{mv.releaseYear ?? '—'}</td>
                <td>{mv.monitored ? 'Yes' : 'No'}</td>
                <td>{mv.hasFile ? 'Yes' : 'No'}</td>
                <td>
                  {grabStatus[mv.id] ? (
                    grabStatus[mv.id]
                  ) : !mv.hasFile && mv.youtubeVideoId ? (
                    <button className="secondary" onClick={() => handleGrab(mv.id)}>
                      Grab
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No music videos yet.</p>
      )}

      <YoutubeSourcesSection artistId={artistId} />
    </div>
  );
}

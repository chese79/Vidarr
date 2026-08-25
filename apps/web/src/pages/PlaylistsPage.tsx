import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import VideoThumb from '../components/VideoThumb';

function PlaylistCard({ playlistId }: { playlistId: number }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pushStatus, setPushStatus] = useState<Record<number, string>>({});

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const playlist = playlists.data?.find((p) => p.id === playlistId);

  const downloaded = useQuery({
    queryKey: ['musicVideos', 'downloaded'],
    queryFn: () => api.musicVideos.list({ hasFile: true }),
    enabled: adding,
  });

  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['playlists'] });

  const addItem = useMutation({
    mutationFn: (musicVideoId: number) => api.playlists.addItem(playlistId, musicVideoId),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (musicVideoId: number) => api.playlists.removeItem(playlistId, musicVideoId),
    onSuccess: invalidate,
  });
  const removePlaylist = useMutation({
    mutationFn: () => api.playlists.remove(playlistId),
    onSuccess: invalidate,
  });

  async function handlePush(connectorId: number) {
    setPushStatus((s) => ({ ...s, [connectorId]: 'Pushing…' }));
    try {
      const result = await api.playlists.push(playlistId, connectorId);
      setPushStatus((s) => ({
        ...s,
        [connectorId]: result.unmatchedTitles.length
          ? `Pushed — ${result.matchedCount} matched, ${result.unmatchedTitles.length} not found: ${result.unmatchedTitles.join(', ')}`
          : `Pushed — ${result.matchedCount} video(s)`,
      }));
    } catch (err) {
      setPushStatus((s) => ({ ...s, [connectorId]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  if (!playlist) return null;
  const inPlaylist = new Set(playlist.items.map((i) => i.musicVideoId));
  const pushableConnectors = (connectors.data ?? []).filter((c) => c.enabled && c.type !== 'subsonic');

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{playlist.name}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="secondary" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Done adding' : 'Add videos'}
          </button>
          <button className="secondary" onClick={() => removePlaylist.mutate()}>
            Delete playlist
          </button>
        </div>
      </div>

      {playlist.items.length ? (
        <div className="video-list">
          {playlist.items.map((item) => (
            <div className="video-row" key={item.id}>
              <VideoThumb url={item.musicVideo.thumbnailUrl} />
              <div className="video-info">
                <strong>{item.musicVideo.title}</strong>
                <span className="empty-state" style={{ padding: 0 }}>
                  {item.musicVideo.artist.name}
                </span>
              </div>
              <div className="video-actions">
                <button className="secondary" onClick={() => removeItem.mutate(item.musicVideoId)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No videos in this playlist yet.</p>
      )}

      {adding && (
        <div className="video-list" style={{ marginTop: 8 }}>
          {(downloaded.data ?? [])
            .filter((v) => !inPlaylist.has(v.id))
            .map((v) => (
              <div className="video-row" key={v.id}>
                <div className="video-info">
                  <strong>{v.title}</strong>
                  <span className="empty-state" style={{ padding: 0 }}>
                    {v.artist.name}
                  </span>
                </div>
                <div className="video-actions">
                  <button onClick={() => addItem.mutate(v.id)}>Add</button>
                </div>
              </div>
            ))}
          {downloaded.data?.length === 0 && <p className="empty-state">No downloaded videos yet.</p>}
        </div>
      )}

      {pushableConnectors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="empty-state" style={{ padding: '0 0 6px' }}>
            Push to library:
          </p>
          {pushableConnectors.map((c) => {
            const sync = playlist.syncs.find((s) => s.connectorId === c.id);
            return (
              <div className="form-row" key={c.id} style={{ alignItems: 'center' }}>
                <button
                  className="secondary"
                  onClick={() => handlePush(c.id)}
                  disabled={!c.videoLibraryId}
                  title={!c.videoLibraryId ? 'Pick a video library for this connector first' : undefined}
                >
                  Push to {c.name}
                </button>
                <span className="empty-state" style={{ padding: 0 }}>
                  {pushStatus[c.id] ?? (sync ? `Last: ${sync.lastPushStatus} (${sync.lastPushedAt})` : '—')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PlaylistsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });

  const createPlaylist = useMutation({
    mutationFn: api.playlists.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createPlaylist.mutate({ name });
  }

  return (
    <div>
      <div className="page-header">
        <h2>Playlists</h2>
      </div>

      <form className="form-row" onSubmit={handleSubmit}>
        <input
          placeholder="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 240 }}
          required
        />
        <button type="submit">Create Playlist</button>
      </form>

      {playlists.data?.length ? (
        playlists.data.map((p) => <PlaylistCard key={p.id} playlistId={p.id} />)
      ) : (
        <p className="empty-state">No playlists yet.</p>
      )}
    </div>
  );
}

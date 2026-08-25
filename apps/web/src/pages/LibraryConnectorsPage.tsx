import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { LibraryConnector, LibraryConnectorType, LibrarySection } from '@vidarr/shared-types';

// Video library picker — separate from the music-library section used to read
// listened-to artists. This is where the connector will look for vidarr's own
// downloaded music videos when pushing a playlist (see playlist push).
function VideoLibraryPicker({ connector }: { connector: LibraryConnector }) {
  const queryClient = useQueryClient();
  const [sections, setSections] = useState<LibrarySection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConnector = useMutation({
    mutationFn: (videoLibraryId: string) => api.libraryConnectors.update(connector.id, { videoLibraryId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['libraryConnectors'] }),
  });

  async function loadSections() {
    setLoading(true);
    setError(null);
    try {
      setSections(await api.libraryConnectors.sections(connector.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (connector.type === 'subsonic') return <span className="empty-state">n/a</span>;

  if (!sections) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className="secondary" onClick={loadSections} disabled={loading}>
          {loading ? 'Loading…' : connector.videoLibraryId ? `Library #${connector.videoLibraryId}` : 'Choose…'}
        </button>
        {error && (
          <span className="empty-state" style={{ padding: 0 }} title={error}>
            Failed to load libraries
          </span>
        )}
      </div>
    );
  }

  return (
    <select
      value={connector.videoLibraryId ?? ''}
      onChange={(e) => updateConnector.mutate(e.target.value)}
    >
      <option value="">Select video library…</option>
      {sections.map((s) => (
        <option key={s.id} value={s.id}>
          {s.title} ({s.type})
        </option>
      ))}
    </select>
  );
}

export default function LibraryConnectorsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<LibraryConnectorType>('plex');
  const [host, setHost] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Record<number, string>>({});

  const connectors = useQuery({
    queryKey: ['libraryConnectors'],
    queryFn: api.libraryConnectors.list,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['libraryConnectors'] });

  const createConnector = useMutation({
    mutationFn: api.libraryConnectors.create,
    onSuccess: () => {
      invalidate();
      setName('');
      setHost('');
      setAuthToken('');
      setUsername('');
      setPassword('');
    },
  });

  const removeConnector = useMutation({
    mutationFn: api.libraryConnectors.remove,
    onSuccess: invalidate,
  });

  async function handleTest(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Testing…' }));
    const result = await api.libraryConnectors.test(id);
    setStatus((s) => ({ ...s, [id]: result.ok ? 'Connection OK' : `Failed: ${result.message}` }));
    invalidate();
  }

  async function handleSync(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Syncing…' }));
    try {
      const result = await api.libraryConnectors.sync(id);
      setStatus((s) => ({ ...s, [id]: `Synced ${result.artistCount} artists` }));
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: `Sync failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  async function handleSyncPlayCounts(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Syncing play counts…' }));
    try {
      const result = await api.libraryConnectors.syncPlayCounts(id);
      setStatus((s) => ({ ...s, [id]: `Play counts: ${result.matched} matched, ${result.unmatched} unmatched` }));
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: `Play-count sync failed: ${(err as Error).message}` }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !host) return;
    createConnector.mutate({
      name,
      type,
      host,
      authToken: authToken || undefined,
      username: username || undefined,
      password: password || undefined,
      enabled: true,
    });
  }

  return (
    <div>
      <div className="page-header">
        <h2>Library Connectors</h2>
      </div>

      <form className="card" onSubmit={handleSubmit}>
        <div className="form-row">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={type} onChange={(e) => setType(e.target.value as LibraryConnectorType)}>
            <option value="plex">Plex</option>
            <option value="jellyfin">Jellyfin</option>
            <option value="subsonic">Navidrome / Subsonic</option>
          </select>
          <input
            placeholder="Host, e.g. http://192.168.1.10:32400"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            style={{ minWidth: 260 }}
            required
          />
        </div>
        <div className="form-row">
          {type !== 'subsonic' && (
            <input
              placeholder={type === 'plex' ? 'Plex token' : 'Jellyfin API key'}
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          )}
          {(type === 'jellyfin' || type === 'subsonic') && (
            <input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
          {type === 'subsonic' && (
            <input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <button type="submit">Add</button>
        </div>
      </form>

      {connectors.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Host</th>
              <th>Status</th>
              <th>Video library</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connectors.data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.type}</td>
                <td>{c.host}</td>
                <td>{status[c.id] ?? c.lastSyncStatus ?? '—'}</td>
                <td>
                  <VideoLibraryPicker connector={c} />
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="secondary" onClick={() => handleTest(c.id)}>
                    Test
                  </button>
                  <button className="secondary" onClick={() => handleSync(c.id)}>
                    Sync
                  </button>
                  {c.type !== 'subsonic' && (
                    <button
                      className="secondary"
                      onClick={() => handleSyncPlayCounts(c.id)}
                      disabled={!c.videoLibraryId}
                      title={!c.videoLibraryId ? 'Pick a video library first' : undefined}
                    >
                      Sync Play Counts
                    </button>
                  )}
                  <button className="secondary" onClick={() => removeConnector.mutate(c.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No library connectors yet.</p>
      )}
    </div>
  );
}

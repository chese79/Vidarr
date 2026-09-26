import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  DiscoveredServer,
  LibraryConnector,
  LibraryConnectorType,
  LibrarySection,
  LibraryVideo,
} from '@vidarr/shared-types';

// The music and video sections are deliberately selected independently: one
// seeds Discover, while the other contains vidarr's organized video files.
function LibraryPicker({ connector, kind }: { connector: LibraryConnector; kind: 'music' | 'video' }) {
  const pickerLabel = `${kind === 'music' ? 'Music' : 'Music video'} library for ${connector.name}`;
  const queryClient = useQueryClient();
  const [sections, setSections] = useState<LibrarySection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = kind === 'music' ? connector.musicLibraryId : connector.videoLibraryId;
  const visibleSections = sections
    ? [...sections].sort((a, b) => {
        const isRecommended = (section: LibrarySection) => {
          const type = section.type.toLowerCase();
          return kind === 'music'
            ? type === 'music' || type === 'artist'
            : type === 'musicvideos';
        };

        return Number(isRecommended(b)) - Number(isRecommended(a))
          || a.title.localeCompare(b.title);
      })
    : null;
  const updateConnector = useMutation({
    mutationFn: (libraryId: string) =>
      api.libraryConnectors.update(
        connector.id,
        kind === 'music' ? { musicLibraryId: libraryId } : { videoLibraryId: libraryId },
      ),
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
        <button className="secondary" onClick={loadSections} disabled={loading} aria-label={pickerLabel}>
          {loading ? 'Loading…' : selectedId ? `Library #${selectedId}` : 'Choose…'}
        </button>
        {error && (
          <span className="empty-state" style={{ padding: 0 }} title={error} role="status">
            Failed to load libraries
          </span>
        )}
      </div>
    );
  }

  return (
    <select
      value={selectedId ?? ''}
      onChange={(e) => updateConnector.mutate(e.target.value)}
      aria-label={pickerLabel}
    >
      <option value="">Select {kind === 'music' ? 'music' : 'music video'} library…</option>
      {visibleSections?.map((s) => (
        <option key={s.id} value={s.id}>
          {s.title} ({s.type})
          {(kind === 'music'
            ? ['music', 'artist'].includes(s.type.toLowerCase())
            : s.type.toLowerCase() === 'musicvideos')
            ? ' — recommended'
            : ''}
        </option>
      ))}
    </select>
  );
}

// Edit form for one existing connector — lets host/token/username (and, for
// Subsonic, password) be corrected in place instead of forcing a
// delete-and-recreate whenever a credential is wrong or a server moves.
// Isolated per-row state, same pattern as VideoLibraryPicker above.
function ConnectorRow({
  connector,
  status,
  unmatchedVideos,
  expanded,
  onToggleExpand,
  reviewVideos,
  reviewExpanded,
  onToggleReviewExpand,
  onTest,
  onSync,
  onSyncPlayCounts,
  onRemove,
}: {
  connector: LibraryConnector;
  status: string | undefined;
  unmatchedVideos: LibraryVideo[];
  expanded: boolean;
  onToggleExpand: () => void;
  reviewVideos: LibraryVideo[];
  reviewExpanded: boolean;
  onToggleReviewExpand: () => void;
  onTest: () => void;
  onSync: () => void;
  onSyncPlayCounts: () => void;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const invalidateVideos = () => queryClient.invalidateQueries({ queryKey: ['libraryVideos'] });
  const confirmMatch = useMutation({ mutationFn: api.libraryVideos.confirmMatch, onSuccess: invalidateVideos });
  const rejectMatch = useMutation({ mutationFn: api.libraryVideos.rejectMatch, onSuccess: invalidateVideos });
  const [name, setName] = useState(connector.name);
  const [host, setHost] = useState(connector.host);
  const [authToken, setAuthToken] = useState('');
  const [username, setUsername] = useState(connector.username ?? '');
  const [password, setPassword] = useState('');
  const [musicPath, setMusicPath] = useState(connector.musicPath ?? '');

  const update = useMutation({
    mutationFn: () =>
      api.libraryConnectors.update(connector.id, {
        name,
        host,
        ...(authToken ? { authToken } : {}),
        username: username || null,
        ...(password ? { password } : {}),
        musicPath: musicPath || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryConnectors'] });
      setPassword('');
      setEditing(false);
    },
  });

  function startEditing() {
    setName(connector.name);
    setHost(connector.host);
    setAuthToken('');
    setUsername(connector.username ?? '');
    setPassword('');
    setMusicPath(connector.musicPath ?? '');
    update.reset();
    setEditing(true);
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={9}>
          <div className="form-row" style={{ flexWrap: 'wrap' }}>
            <input placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              placeholder="Host, e.g. http://192.168.1.10:8096"
              aria-label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              style={{ minWidth: 220 }}
            />
            {connector.type !== 'subsonic' && (
              <input
                placeholder={`${connector.type === 'plex' ? 'Plex token' : 'Jellyfin API key'}${connector.hasAuthToken ? ' (leave blank to keep)' : ''}`}
                aria-label={connector.type === 'plex' ? 'Plex token' : 'Jellyfin API key'}
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
              />
            )}
            {(connector.type === 'jellyfin' || connector.type === 'subsonic') && (
              <input
                placeholder="Username"
                aria-label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
            {connector.type === 'subsonic' && (
              <input
                placeholder="New password (leave blank to keep current)"
                aria-label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <input
              placeholder="Optional audio path, e.g. /media/music"
              aria-label="Embedded music tag path"
              value={musicPath}
              onChange={(e) => setMusicPath(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <button onClick={() => update.mutate()} disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {update.isError && (
            <p className="empty-state" role="alert">
              {(update.error as Error).message}
            </p>
          )}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td>{connector.name}</td>
        <td>{connector.type}</td>
        <td>{connector.host}</td>
        <td role="status">
          {connector.syncRunning
            ? `Running ${connector.syncProcessed}/${connector.syncTotal ?? '?'} `
            : status ?? connector.lastSyncStatus ?? '—'}
        </td>
        <td>
          <LibraryPicker connector={connector} kind="music" />
          {connector.musicPath && <small style={{ display: 'block' }}>Tags: {connector.musicPath}</small>}
        </td>
        <td>
          <LibraryPicker connector={connector} kind="video" />
        </td>
        <td>
          {unmatchedVideos.length > 0 ? (
            <button type="button" className="secondary" aria-expanded={expanded} onClick={onToggleExpand}>
              {expanded ? 'Hide' : 'Show'} {unmatchedVideos.length} unmatched
            </button>
          ) : (
            <span className="empty-state" style={{ padding: 0 }}>
              None
            </span>
          )}
        </td>
        <td>
          {reviewVideos.length > 0 ? (
            <button type="button" className="secondary" aria-expanded={reviewExpanded} onClick={onToggleReviewExpand}>
              {reviewExpanded ? 'Hide' : 'Show'} {reviewVideos.length} to review
            </button>
          ) : (
            <span className="empty-state" style={{ padding: 0 }}>
              None
            </span>
          )}
        </td>
        <td style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="secondary" aria-label={`Test ${connector.name}`} onClick={onTest}>
              Test
            </button>
            <button className="secondary" aria-label={`Sync ${connector.name}`} onClick={onSync}>
              Sync
            </button>
            {connector.type !== 'subsonic' && (
              <button
                className="secondary"
                aria-label={`Sync play counts for ${connector.name}`}
                onClick={onSyncPlayCounts}
                disabled={!connector.videoLibraryId}
              >
                Sync Play Counts
              </button>
            )}
            <button className="secondary" aria-label={`Edit ${connector.name}`} onClick={startEditing}>
              Edit
            </button>
            <button className="secondary" aria-label={`Remove ${connector.name}`} onClick={onRemove}>
              Remove
            </button>
          </div>
          {/* Visible text, not just a title tooltip on the disabled button above —
              a keyboard/screen-reader user can't hover a disabled control to read
              a title attribute, and this is the button's own necessary context. */}
          {connector.type !== 'subsonic' && !connector.videoLibraryId && (
            <span className="empty-state" style={{ padding: 0, fontSize: 12 }}>
              Pick a music video library first to sync play counts.
            </span>
          )}
        </td>
      </tr>
      {expanded && unmatchedVideos.length > 0 && (
        <tr>
          <td colSpan={9}>
            {/* Videos this connector reports as available with no corresponding
                vidarr artist/video at all — distinct from a fuzzy, unreviewed
                match, which shows under "Needs review" below instead. */}
            <div className="unmatched-video-list" tabIndex={0} role="region" aria-label="Unmatched videos">
              {unmatchedVideos.map((v) => (
                <div className="unmatched-video-row" key={v.id}>
                  <span className="title" title={v.title}>
                    {v.title}
                  </span>
                  <span className="empty-state" style={{ padding: 0 }}>
                    {v.artistName}
                    {v.releaseYear ? ` · ${v.releaseYear}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
      {reviewExpanded && reviewVideos.length > 0 && (
        <tr>
          <td colSpan={9}>
            {/* A fuzzy match a sync proposed but didn't hit the exact-key fast
                path — confidence label plus a side-by-side comparison so a
                human can tell at a glance whether to keep it. */}
            <div className="unmatched-video-list" tabIndex={0} role="region" aria-label="Matches needing review">
              {reviewVideos.map((v) => (
                <div className="unmatched-video-row review-row" key={v.id}>
                  <span
                    className={`status-chip ${v.matchConfidence === 'probable' ? 'available' : 'missing'}`}
                  >
                    {v.matchConfidence === 'probable' ? 'Probable' : 'Ambiguous'}
                  </span>
                  <span className="title" title={v.title}>
                    {v.title}
                  </span>
                  <span className="empty-state" style={{ padding: 0 }}>
                    {v.artistName}
                    {v.releaseYear ? ` · ${v.releaseYear}` : ''}
                  </span>
                  <span aria-hidden="true">→</span>
                  {v.matchedVideo && (
                    <span className="title" title={v.matchedVideo.title}>
                      {v.matchedVideo.title}
                      <span className="empty-state" style={{ padding: 0 }}>
                        {' '}
                        — {v.matchedVideo.artistName}
                        {v.matchedVideo.releaseYear ? ` · ${v.matchedVideo.releaseYear}` : ''}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Confirm match for ${v.title}`}
                    onClick={() => confirmMatch.mutate(v.id)}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Reject match for ${v.title}`}
                    onClick={() => rejectMatch.mutate(v.id)}
                  >
                    Reject
                  </button>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
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
  const [musicPath, setMusicPath] = useState('');
  const [status, setStatus] = useState<Record<number, string>>({});
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredServer[] | null>(null);
  const [expandedUnmatched, setExpandedUnmatched] = useState<Set<number>>(new Set());
  const [expandedReview, setExpandedReview] = useState<Set<number>>(new Set());

  const connectors = useQuery({
    queryKey: ['libraryConnectors'],
    queryFn: api.libraryConnectors.list,
    refetchInterval: 2000,
  });
  const libraryVideos = useQuery({ queryKey: ['libraryVideos'], queryFn: api.libraryVideos.list });

  function toggleUnmatchedExpanded(connectorId: number) {
    setExpandedUnmatched((prev) => {
      const next = new Set(prev);
      if (next.has(connectorId)) next.delete(connectorId);
      else next.add(connectorId);
      return next;
    });
  }

  function toggleReviewExpanded(connectorId: number) {
    setExpandedReview((prev) => {
      const next = new Set(prev);
      if (next.has(connectorId)) next.delete(connectorId);
      else next.add(connectorId);
      return next;
    });
  }

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
      setMusicPath('');
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
      setStatus((s) => ({
        ...s,
        [id]: `Synced ${result.artistCount} artists, ${result.videoCount} videos; ${result.recommendationCount} recommendations`,
      }));
      queryClient.invalidateQueries({ queryKey: ['libraryVideos'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: `Sync failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  async function handleDiscover() {
    if (type === 'subsonic') return;
    setDiscovering(true);
    setDiscovered(null);
    try {
      setDiscovered(await api.libraryConnectors.discover(type));
    } catch {
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  }

  function applyDiscovered(server: DiscoveredServer) {
    setHost(server.host);
    if (!name) setName(server.name);
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
      musicPath: musicPath || undefined,
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
          <input
            placeholder="Name"
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            value={type}
            aria-label="Connector type"
            onChange={(e) => {
              setType(e.target.value as LibraryConnectorType);
              setDiscovered(null);
            }}
          >
            <option value="plex">Plex</option>
            <option value="jellyfin">Jellyfin</option>
            <option value="subsonic">Navidrome / Subsonic</option>
          </select>
          <input
            placeholder="Host, e.g. http://192.168.1.10:32400"
            aria-label="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            style={{ minWidth: 260 }}
            required
          />
          {type !== 'subsonic' && (
            <button type="button" className="secondary" onClick={handleDiscover} disabled={discovering}>
              {discovering ? 'Searching…' : 'Auto-detect'}
            </button>
          )}
        </div>
        {discovered && (
          <div className="form-row">
            {discovered.length ? (
              <select
                defaultValue=""
                aria-label="Discovered server"
                onChange={(e) => {
                  const server = discovered.find((s) => s.host === e.target.value);
                  if (server) applyDiscovered(server);
                }}
              >
                <option value="" disabled>
                  {discovered.length} found on your network — pick one…
                </option>
                {discovered.map((s) => (
                  <option key={s.host} value={s.host}>
                    {s.name} ({s.host})
                  </option>
                ))}
              </select>
            ) : (
              <span className="empty-state" style={{ padding: 0 }}>
                No servers found on your network — enter the address manually.
              </span>
            )}
          </div>
        )}
        <div className="form-row">
          {type !== 'subsonic' && (
          <input
              placeholder={type === 'plex' ? 'Plex token' : 'Jellyfin API key'}
              aria-label={type === 'plex' ? 'Plex token' : 'Jellyfin API key'}
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          )}
          {(type === 'jellyfin' || type === 'subsonic') && (
            <input
              placeholder="Username"
              aria-label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
          {type === 'subsonic' && (
            <input
              placeholder="Password"
              aria-label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <input
            placeholder="Optional audio path for Picard tags, e.g. /media/music"
            aria-label="Embedded music tag path"
            value={musicPath}
            onChange={(e) => setMusicPath(e.target.value)}
            style={{ minWidth: 260 }}
          />
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
              <th>
                Music library
                <small style={{ display: 'block', fontWeight: 400 }}>(artist matching only)</small>
              </th>
              <th>Music Video library</th>
              <th>Unmatched videos</th>
              <th>Needs review</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connectors.data.map((c) => (
              <ConnectorRow
                key={c.id}
                connector={c}
                status={status[c.id]}
                unmatchedVideos={
                  libraryVideos.data?.filter((v) => v.connectorId === c.id && v.musicVideoId == null) ?? []
                }
                expanded={expandedUnmatched.has(c.id)}
                onToggleExpand={() => toggleUnmatchedExpanded(c.id)}
                reviewVideos={
                  libraryVideos.data?.filter((v) => v.connectorId === c.id && v.matchConfidence != null) ?? []
                }
                reviewExpanded={expandedReview.has(c.id)}
                onToggleReviewExpand={() => toggleReviewExpanded(c.id)}
                onTest={() => handleTest(c.id)}
                onSync={() => handleSync(c.id)}
                onSyncPlayCounts={() => handleSyncPlayCounts(c.id)}
                onRemove={() => removeConnector.mutate(c.id)}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No library connectors yet.</p>
      )}
    </div>
  );
}

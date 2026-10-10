import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function RootFoldersPage() {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');
  const [targetConnectorId, setTargetConnectorId] = useState<number | ''>('');

  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });

  const createFolder = useMutation({
    mutationFn: api.rootFolders.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rootFolders'] });
      setPath('');
      setTargetConnectorId('');
    },
  });

  const removeFolder = useMutation({
    mutationFn: api.rootFolders.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rootFolders'] }),
  });
  const updateFolder = useMutation({
    mutationFn: ({ id, targetConnectorId }: { id: number; targetConnectorId: number | null }) =>
      api.rootFolders.update(id, { targetConnectorId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rootFolders'] }),
  });

  return (
    <div>
      <div className="page-header">
        <h2>Root Folders</h2>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (path) createFolder.mutate({ path, targetConnectorId: targetConnectorId || null });
        }}
      >
        <p className="muted">
          Enter an absolute path visible inside Vidarr. In Docker, use the mounted container path (for example <code>/media</code> or <code>/mnt/d/media</code>), not a Windows host path.
        </p>
        <div className="form-row">
          <input
            placeholder="e.g. /media/music-videos"
            aria-label="Root folder path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            style={{ minWidth: 320 }}
            required
          />
          <select
            aria-label="Target media-server video library"
            value={targetConnectorId}
            onChange={(e) => setTargetConnectorId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Select server — delivery remains pending</option>
            {connectors.data?.filter((connector) => connector.enabled && ['plex', 'jellyfin'].includes(connector.type) && connector.videoLibraryId).map((connector) => (
              <option key={connector.id} value={connector.id}>{connector.name}</option>
            ))}
          </select>
          <button type="submit">Add</button>
        </div>
        {createFolder.error ? <p className="error">{createFolder.error.message}</p> : null}
      </form>

      {rootFolders.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Target media server</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rootFolders.data.map((rf) => (
              <tr key={rf.id}>
                <td>{rf.path}</td>
                <td>
                  <select
                    aria-label={`Target media server for ${rf.path}`}
                    value={rf.targetConnectorId ?? ''}
                    onChange={(e) => updateFolder.mutate({ id: rf.id, targetConnectorId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Select server — delivery remains pending</option>
                    {connectors.data?.filter((connector) => connector.enabled && ['plex', 'jellyfin'].includes(connector.type) && connector.videoLibraryId).map((connector) => (
                      <option key={connector.id} value={connector.id}>{connector.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="secondary"
                    aria-label={`Remove ${rf.path}`}
                    onClick={() => removeFolder.mutate(rf.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No root folders yet.</p>
      )}
      {updateFolder.error && <p className="error">{updateFolder.error.message}</p>}
      {rootFolders.data?.some(folder => !folder.targetConnectorId) && <p className="muted">Downloads need a target server library that can access this folder. Delivery remains pending until the server catalogs the video.</p>}
    </div>
  );
}

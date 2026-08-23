import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function RootFoldersPage() {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');

  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });

  const createFolder = useMutation({
    mutationFn: api.rootFolders.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rootFolders'] });
      setPath('');
    },
  });

  const removeFolder = useMutation({
    mutationFn: api.rootFolders.remove,
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
          if (path) createFolder.mutate({ path });
        }}
      >
        <div className="form-row">
          <input
            placeholder="e.g. D:\Media\Music Videos"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            style={{ minWidth: 320 }}
            required
          />
          <button type="submit">Add</button>
        </div>
      </form>

      {rootFolders.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rootFolders.data.map((rf) => (
              <tr key={rf.id}>
                <td>{rf.path}</td>
                <td>
                  <button className="secondary" onClick={() => removeFolder.mutate(rf.id)}>
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
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [rootFolderId, setRootFolderId] = useState<number | ''>('');
  const [qualityProfileId, setQualityProfileId] = useState<number | ''>('');

  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({
    queryKey: ['qualityProfiles'],
    queryFn: api.qualityProfiles.list,
  });

  const createArtist = useMutation({
    mutationFn: api.artists.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      setShowAdd(false);
      setName('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || rootFolderId === '' || qualityProfileId === '') return;
    createArtist.mutate({
      name,
      monitored: true,
      rootFolderId: Number(rootFolderId),
      qualityProfileId: Number(qualityProfileId),
    });
  }

  const canAdd = (rootFolders.data?.length ?? 0) > 0 && (qualityProfiles.data?.length ?? 0) > 0;

  return (
    <div>
      <div className="page-header">
        <h2>Library</h2>
        <button onClick={() => setShowAdd((v) => !v)} disabled={!canAdd}>
          Add Artist
        </button>
      </div>

      {!canAdd && (
        <p className="empty-state">
          Add a <Link to="/root-folders">root folder</Link> and a{' '}
          <Link to="/quality-profiles">quality profile</Link> before adding an artist.
        </p>
      )}

      {showAdd && (
        <form className="card" onSubmit={handleSubmit}>
          <div className="form-row">
            <input
              placeholder="Artist name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select
              value={rootFolderId}
              onChange={(e) => setRootFolderId(Number(e.target.value))}
              required
            >
              <option value="">Root folder…</option>
              {rootFolders.data?.map((rf) => (
                <option key={rf.id} value={rf.id}>
                  {rf.path}
                </option>
              ))}
            </select>
            <select
              value={qualityProfileId}
              onChange={(e) => setQualityProfileId(Number(e.target.value))}
              required
            >
              <option value="">Quality profile…</option>
              {qualityProfiles.data?.map((qp) => (
                <option key={qp.id} value={qp.id}>
                  {qp.name}
                </option>
              ))}
            </select>
            <button type="submit">Save</button>
          </div>
        </form>
      )}

      {artists.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Monitored</th>
            </tr>
          </thead>
          <tbody>
            {artists.data.map((artist) => (
              <tr key={artist.id}>
                <td>
                  <Link to={`/artist/${artist.id}`}>{artist.name}</Link>
                </td>
                <td>{artist.monitored ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No artists yet.</p>
      )}
    </div>
  );
}

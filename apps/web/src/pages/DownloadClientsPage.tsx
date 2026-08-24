import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { DownloadClientImplementation } from '@vidarr/shared-types';

export default function DownloadClientsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [implementation, setImplementation] = useState<DownloadClientImplementation>('qBittorrent');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Record<number, string>>({});

  const clients = useQuery({ queryKey: ['downloadClients'], queryFn: api.downloadClients.list });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['downloadClients'] });

  const createClient = useMutation({
    mutationFn: api.downloadClients.create,
    onSuccess: () => {
      invalidate();
      setName('');
      setHost('');
      setPort('');
      setUsername('');
      setPassword('');
      setApiKey('');
    },
  });

  const removeClient = useMutation({
    mutationFn: api.downloadClients.remove,
    onSuccess: invalidate,
  });

  async function handleTest(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Testing…' }));
    const result = await api.downloadClients.test(id);
    setStatus((s) => ({ ...s, [id]: result.ok ? 'Connection OK' : `Failed: ${result.message}` }));
  }

  return (
    <div>
      <div className="page-header">
        <h2>Download Clients</h2>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name || !host || !port) return;
          createClient.mutate({
            name,
            implementation,
            host,
            port: Number(port),
            username: username || undefined,
            password: password || undefined,
            apiKey: apiKey || undefined,
            enabled: true,
          });
        }}
      >
        <div className="form-row">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select
            value={implementation}
            onChange={(e) => setImplementation(e.target.value as DownloadClientImplementation)}
          >
            <option value="qBittorrent">qBittorrent</option>
            <option value="SABnzbd">SABnzbd</option>
          </select>
          <input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} required />
          <input
            placeholder="Port"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{ width: 100 }}
            required
          />
        </div>
        <div className="form-row">
          {implementation === 'qBittorrent' ? (
            <>
              <input
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          ) : (
            <input placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          )}
          <button type="submit">Add</button>
        </div>
      </form>

      {clients.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Implementation</th>
              <th>Host</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.implementation}</td>
                <td>
                  {c.host}:{c.port}
                </td>
                <td>{status[c.id] ?? '—'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="secondary" onClick={() => handleTest(c.id)}>
                    Test
                  </button>
                  <button className="secondary" onClick={() => removeClient.mutate(c.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No download clients yet.</p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { DownloadClient, DownloadClientImplementation } from '@vidarr/shared-types';

// Inline edit for an existing download client — previously the only way to
// fix a wrong host/port/credential was to delete the row and re-add it.
// implementation isn't editable: qBittorrent and SABnzbd take different
// credential fields entirely, so switching one is a delete-and-recreate
// decision, not an edit.
function DownloadClientRow({ client, status, onTest, onRemove }: {
  client: DownloadClient;
  status: string | undefined;
  onTest: () => void;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [host, setHost] = useState(client.host);
  const [port, setPort] = useState(String(client.port));
  const [username, setUsername] = useState(client.username ?? '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');

  const update = useMutation({
    mutationFn: () =>
      api.downloadClients.update(client.id, {
        name,
        host,
        port: Number(port),
        username: username || null,
        ...(password ? { password } : {}),
        ...(apiKey ? { apiKey } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloadClients'] });
      setPassword('');
      setApiKey('');
      setEditing(false);
    },
  });

  function startEditing() {
    setName(client.name);
    setHost(client.host);
    setPort(String(client.port));
    setUsername(client.username ?? '');
    setPassword('');
    setApiKey('');
    update.reset();
    setEditing(true);
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <div className="form-row" style={{ flexWrap: 'wrap' }}>
            <input placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="Host" aria-label="Host" value={host} onChange={(e) => setHost(e.target.value)} />
            <input
              placeholder="Port"
              aria-label="Port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              style={{ width: 100 }}
            />
            {client.implementation === 'qBittorrent' ? (
              <>
                <input
                  placeholder="Username"
                  aria-label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <input
                  placeholder={client.hasPassword ? 'New password (leave blank to keep current)' : 'Password'}
                  aria-label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            ) : (
              <input
                placeholder={client.hasApiKey ? 'New API key (leave blank to keep current)' : 'API key'}
                aria-label="API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            )}
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
    <tr>
      <td>{client.name}</td>
      <td>{client.implementation}</td>
      <td>
        {client.host}:{client.port}
      </td>
      <td role="status">{status ?? '—'}</td>
      <td style={{ display: 'flex', gap: 6 }}>
        <button className="secondary" aria-label={`Test ${client.name}`} onClick={onTest}>
          Test
        </button>
        <button className="secondary" aria-label={`Edit ${client.name}`} onClick={startEditing}>
          Edit
        </button>
        <button className="secondary" aria-label={`Remove ${client.name}`} onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  );
}

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
          <input
            placeholder="Name"
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            value={implementation}
            aria-label="Implementation"
            onChange={(e) => setImplementation(e.target.value as DownloadClientImplementation)}
          >
            <option value="qBittorrent">qBittorrent</option>
            <option value="SABnzbd">SABnzbd</option>
          </select>
          <input
            placeholder="Host"
            aria-label="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
          />
          <input
            placeholder="Port"
            aria-label="Port"
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
                aria-label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                placeholder="Password"
                aria-label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          ) : (
            <input
              placeholder="API key"
              aria-label="API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
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
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.data.map((c) => (
              <DownloadClientRow
                key={c.id}
                client={c}
                status={status[c.id]}
                onTest={() => handleTest(c.id)}
                onRemove={() => removeClient.mutate(c.id)}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No download clients yet.</p>
      )}
    </div>
  );
}

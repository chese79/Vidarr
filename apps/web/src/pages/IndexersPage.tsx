import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Indexer, IndexerImplementation } from '@vidarr/shared-types';

function parseCategories(input: string): number[] {
  return input
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function CategoriesCell({ indexer }: { indexer: Indexer }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(JSON.parse(indexer.categories || '[]').join(', '));

  const update = useMutation({
    mutationFn: () => api.indexers.updateCategories(indexer.id, parseCategories(value)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['indexers'] }),
  });

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="3020"
        aria-label={`Categories for ${indexer.name}`}
        style={{ width: 90 }}
      />
      <button className="secondary" onClick={() => update.mutate()}>
        Save
      </button>
    </div>
  );
}

// Inline edit for an existing indexer's name/URL/API key — previously the
// only way to fix a wrong base URL or a rotated API key was to delete the
// row and re-add it, losing its priority. Implementation isn't editable
// here: Torznab vs. Newznab changes what a "categories" value even means,
// so that's a delete-and-recreate decision, not an edit.
function IndexerRow({ indexer, status, onTest, onRemove }: {
  indexer: Indexer;
  status: string | undefined;
  onTest: () => void;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(indexer.name);
  const [baseUrl, setBaseUrl] = useState(indexer.baseUrl);
  const [apiKey, setApiKey] = useState('');

  const update = useMutation({
    mutationFn: () =>
      api.indexers.update(indexer.id, {
        name,
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['indexers'] });
      setApiKey('');
      setEditing(false);
    },
  });

  function startEditing() {
    setName(indexer.name);
    setBaseUrl(indexer.baseUrl);
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
            <input
              placeholder="Base URL"
              aria-label="Base URL"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <input
              placeholder={indexer.hasApiKey ? 'New API key (leave blank to keep current)' : 'API key'}
              aria-label="API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
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
    <tr>
      <td>{indexer.name}</td>
      <td>{indexer.implementation}</td>
      <td>
        <CategoriesCell indexer={indexer} />
      </td>
      <td role="status">{status ?? '—'}</td>
      <td style={{ display: 'flex', gap: 6 }}>
        <button className="secondary" aria-label={`Test ${indexer.name}`} onClick={onTest}>
          Test
        </button>
        <button className="secondary" aria-label={`Edit ${indexer.name}`} onClick={startEditing}>
          Edit
        </button>
        <button className="secondary" aria-label={`Remove ${indexer.name}`} onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  );
}

export default function IndexersPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [implementation, setImplementation] = useState<IndexerImplementation>('Torznab');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [categories, setCategories] = useState('3020');
  const [status, setStatus] = useState<Record<number, string>>({});

  const indexers = useQuery({ queryKey: ['indexers'], queryFn: api.indexers.list });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['indexers'] });

  const createIndexer = useMutation({
    mutationFn: api.indexers.create,
    onSuccess: () => {
      invalidate();
      setName('');
      setBaseUrl('');
      setApiKey('');
    },
  });

  const removeIndexer = useMutation({
    mutationFn: api.indexers.remove,
    onSuccess: invalidate,
  });

  async function handleTest(id: number) {
    setStatus((s) => ({ ...s, [id]: 'Testing…' }));
    const result = await api.indexers.test(id);
    setStatus((s) => ({ ...s, [id]: result.ok ? 'Connection OK' : `Failed: ${result.message}` }));
  }

  return (
    <div>
      <div className="page-header">
        <h2>Indexers</h2>
      </div>

      <p className="empty-state">
        Category 3020 (the standard Newznab/Torznab "Audio &gt; Video" category) is used by
        default so searches only match music videos, not unrelated TV/movie releases that happen
        to share words with a song title. Only change this if you know your indexer categorizes
        music videos differently.
      </p>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name || !baseUrl) return;
          createIndexer.mutate({
            name,
            implementation,
            baseUrl,
            apiKey: apiKey || undefined,
            categories: parseCategories(categories),
            enabled: true,
            priority: 25,
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
            onChange={(e) => setImplementation(e.target.value as IndexerImplementation)}
          >
            <option value="Torznab">Torznab</option>
            <option value="Newznab">Newznab</option>
          </select>
          <input
            placeholder="Base URL, e.g. http://localhost:9117/api/v2.0/indexers/example/results/torznab"
            aria-label="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            style={{ minWidth: 340 }}
            required
          />
          <input
            placeholder="API key"
            aria-label="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input
            placeholder="Categories"
            aria-label="Categories"
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
            style={{ width: 90 }}
          />
          <button type="submit">Add</button>
        </div>
      </form>

      {indexers.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Implementation</th>
              <th>Categories</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {indexers.data.map((idx) => (
              <IndexerRow
                key={idx.id}
                indexer={idx}
                status={status[idx.id]}
                onTest={() => handleTest(idx.id)}
                onRemove={() => removeIndexer.mutate(idx.id)}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No indexers yet.</p>
      )}
    </div>
  );
}

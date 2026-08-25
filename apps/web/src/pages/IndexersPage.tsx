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
        style={{ width: 90 }}
      />
      <button className="secondary" onClick={() => update.mutate()}>
        Save
      </button>
    </div>
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
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select
            value={implementation}
            onChange={(e) => setImplementation(e.target.value as IndexerImplementation)}
          >
            <option value="Torznab">Torznab</option>
            <option value="Newznab">Newznab</option>
          </select>
          <input
            placeholder="Base URL, e.g. http://localhost:9117/api/v2.0/indexers/example/results/torznab"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            style={{ minWidth: 340 }}
            required
          />
          <input placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <input
            placeholder="Categories"
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {indexers.data.map((idx) => (
              <tr key={idx.id}>
                <td>{idx.name}</td>
                <td>{idx.implementation}</td>
                <td>
                  <CategoriesCell indexer={idx} />
                </td>
                <td>{status[idx.id] ?? '—'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="secondary" onClick={() => handleTest(idx.id)}>
                    Test
                  </button>
                  <button className="secondary" onClick={() => removeIndexer.mutate(idx.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No indexers yet.</p>
      )}
    </div>
  );
}

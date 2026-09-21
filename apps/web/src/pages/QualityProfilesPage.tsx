import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function QualityProfilesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [allowed, setAllowed] = useState<Record<number, boolean>>({});
  const [cutoffQualityId, setCutoffQualityId] = useState<number | ''>('');

  const qualities = useQuery({ queryKey: ['qualities'], queryFn: api.qualities.list });
  const profiles = useQuery({ queryKey: ['qualityProfiles'], queryFn: api.qualityProfiles.list });

  const createProfile = useMutation({
    mutationFn: api.qualityProfiles.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualityProfiles'] });
      setName('');
      setAllowed({});
      setCutoffQualityId('');
    },
  });

  const removeProfile = useMutation({
    mutationFn: api.qualityProfiles.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qualityProfiles'] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || cutoffQualityId === '') return;
    createProfile.mutate({
      name,
      cutoffQualityId: Number(cutoffQualityId),
      items: (qualities.data ?? []).map((q) => ({ qualityId: q.id, allowed: !!allowed[q.id] })),
    });
  }

  return (
    <div>
      <div className="page-header">
        <h2>Quality Profiles</h2>
      </div>

      <form className="card" onSubmit={handleSubmit}>
        <div className="form-row">
          <input
            placeholder="Profile name"
            aria-label="Profile name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            value={cutoffQualityId}
            aria-label="Upgrade cutoff quality"
            onChange={(e) => setCutoffQualityId(Number(e.target.value))}
            required
          >
            <option value="">Upgrade cutoff…</option>
            {qualities.data?.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          <button type="submit">Save</button>
        </div>
        <div className="form-row">
          {qualities.data?.map((q) => (
            <label key={q.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={!!allowed[q.id]}
                onChange={(e) => setAllowed((a) => ({ ...a, [q.id]: e.target.checked }))}
              />
              {q.name}
            </label>
          ))}
        </div>
      </form>

      {profiles.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Allowed Qualities</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {profiles.data.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.items.filter((i) => i.allowed).length} allowed</td>
                <td>
                  <button
                    className="secondary"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => removeProfile.mutate(p.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No quality profiles yet.</p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function QueuePage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const queue = useQuery({ queryKey: ['queue'], queryFn: api.queue.list });

  async function handleRefresh() {
    setRefreshing(true);
    const result = await api.queue.refresh();
    setSummary(`${result.completed} completed, ${result.failed} failed, ${result.pending} still downloading`);
    queryClient.invalidateQueries({ queryKey: ['queue'] });
    queryClient.invalidateQueries({ queryKey: ['artist'] });
    setRefreshing(false);
  }

  return (
    <div>
      <div className="page-header">
        <h2>Queue</h2>
        <button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh Queue'}
        </button>
      </div>

      {summary && <p className="empty-state">{summary}</p>}

      {queue.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Artist</th>
              <th>Title</th>
              <th>Source</th>
              <th>Quality</th>
              <th>Status</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {queue.data.map((item) => (
              <tr key={item.id}>
                <td>{item.musicVideo.artist.name}</td>
                <td>{item.musicVideo.title}</td>
                <td>{item.sourceType}</td>
                <td>{item.quality ?? '—'}</td>
                <td>{item.status}</td>
                <td>{Math.round(item.progress * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">Queue is empty.</p>
      )}
    </div>
  );
}

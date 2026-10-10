import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { RecentQueueResults } from '../components/QueueResults';

export default function QueuePage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const queue = useQuery({ queryKey: ['queue'], queryFn: api.queue.list, refetchInterval: 3000 });
  const active = queue.data?.filter(item => item.status !== 'failed') ?? [];

  async function handleRefresh() {
    setRefreshing(true);
    try { const result = await api.queue.refresh();
    setSummary(`${result.completed} completed, ${result.failed} failed, ${result.pending} still downloading`);
    queryClient.invalidateQueries({ queryKey: ['queue'] });
    queryClient.invalidateQueries({ queryKey: ['queueResults'] });
    queryClient.invalidateQueries({ queryKey: ['artist'] });
    } catch (error) { setSummary(`Refresh failed: ${(error as Error).message}`); }
    finally { setRefreshing(false); }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Queue</h2>
        <button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh Now'}
        </button>
      </div>

      <p className="empty-state">
        The queue monitor runs automatically in the background — this list updates on its own
        every few seconds. "Refresh Now" forces an immediate check instead of waiting.
      </p>
      {summary && (
        <p className="empty-state" role="status">
          {summary}
        </p>
      )}

      {queue.isPending ? <p role="status">Loading queue…</p> : queue.isError ? <p role="alert">Could not load queue.</p> : active.length ? (
        <table>
          <thead>
            <tr>
              <th>Artist</th>
              <th>Title</th>
              <th>Source</th>
              <th>Quality</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {active.map((item) => (
              <tr key={item.id}>
                <td>{item.musicVideo.artist.name}</td>
                <td>{item.musicVideo.title}</td>
                <td>{item.sourceType}</td>
                <td>{item.quality ?? '—'}</td>
                <td>{item.status}</td>
                <td>{Math.round(item.progress * 100)}%</td>
                <td>{item.error ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">Queue is empty.</p>
      )}
      <RecentQueueResults section="completed" />
      <RecentQueueResults section="failures" />
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export default function SystemTasksPage() {
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ['systemTasks'],
    queryFn: api.system.tasks,
    refetchInterval: 5000,
  });

  const runTask = useMutation({
    mutationFn: api.system.runTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['systemTasks'] }),
  });

  return (
    <div>
      <div className="page-header">
        <h2>System / Tasks</h2>
      </div>

      {tasks.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Interval</th>
              <th>Last Run</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.data.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{formatInterval(t.intervalMs)}</td>
                <td>{t.lastRunAt ? new Date(t.lastRunAt).toLocaleString() : 'Never'}</td>
                <td>
                  {t.lastResult === 'failed' ? (
                    <span title={t.lastError ?? undefined}>Failed</span>
                  ) : (
                    t.lastResult ?? '—'
                  )}
                </td>
                <td>
                  <button className="secondary" onClick={() => runTask.mutate(t.name)}>
                    Run Now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No scheduled tasks yet — they register on first server start.</p>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Viewing { id: number; serverKey: string; userId: string; watchedSeconds: number; durationSeconds: number | null; qualifiedAt: string | null; completedAt: string | null; active: boolean; positionSeconds: number }
export default function LiveViewingPanel({ performanceId }: { performanceId: number }) {
  const cache = useQueryClient();
  const views = useQuery({ queryKey: ['live-viewings', performanceId], queryFn: () => api.live.read<Viewing[]>(`performances/${performanceId}/viewings`), refetchInterval: 15000 });
  const action = useMutation({ mutationFn: ({ id, action }: { id: number; action: string }) => api.live.action(`viewings/${id}`, { action }), onSuccess: () => cache.invalidateQueries({ queryKey: ['live-viewings', performanceId] }) });
  return <section className="card"><h3>Viewing and resume</h3><p>Observed watching qualifies a song after half its duration or four minutes, and a full performance after half or 30 minutes. Pauses, seeks and unobserved time earn no credit. Unfinished progress is retained indefinitely. Qualification and completion are separate.</p>
    {views.isError && <p role="alert">{views.error.message}</p>}
    {!views.isPending && !views.data?.length && <p>No observed live viewing yet. Play a confirmed copy in the connected Jellyfin/Plex library.</p>}
    {views.data?.map(view => <article key={view.id}><strong>Viewer {view.userId}</strong><p>{Math.floor(view.watchedSeconds / 60)} minutes observed · Resume position {Math.floor(view.positionSeconds / 60)}:{String(Math.floor(view.positionSeconds % 60)).padStart(2, '0')} · {view.qualifiedAt ? 'Qualified play earned' : view.durationSeconds ? 'Not yet qualified' : 'Duration unknown; qualification deferred'} · {view.completedAt ? 'Finished' : 'Unfinished'}</p>
      <details><summary>Playback server</summary>{view.serverKey}</details>
      {view.active && <><button disabled={action.isPending} onClick={() => action.mutate({ id: view.id, action: 'startAgain' })}>Start again</button>{' '}<button disabled={action.isPending} onClick={() => action.mutate({ id: view.id, action: 'markFinished' })}>Mark finished</button></>}
    </article>)}{action.isError && <p role="alert">{action.error.message}</p>}
    <p>Mark finished closes a viewing without adding watched time or a play. Use your playback client's resume or chapter controls to continue watching.</p>
  </section>;
}

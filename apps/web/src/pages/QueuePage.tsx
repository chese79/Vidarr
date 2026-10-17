import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { downloadStage, formatDownloadTimings } from '../components/downloadStage';
import { api } from '../api/client';
import { RecentQueueResults } from '../components/QueueResults';

function ReconcileSubmission({ id, onDone }: { id: number; onDone: (message: string) => void }) {
  const [verified, setVerified] = useState(false);
  const [externalRef, setExternalRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function resolve(action: 'attach' | 'notSubmitted') {
    setBusy(true); setError('');
    try {
      await api.queue.reconcile(id, action === 'attach' ? { action, externalRef: externalRef.trim(), verified: true } : { action, verified: true });
      onDone(action === 'attach' ? 'Linked to the existing client job. Queue monitoring will continue.' : 'Reservation released. Review the video to retry if wanted.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <details><summary>Resolve submission</summary>
    <p>Check the download client's queue and history for this exact video before resolving it.</p>
    <label><input type="checkbox" checked={verified} disabled={busy} onChange={e => setVerified(e.target.checked)} /> I checked the client's queue and history</label>
    <input aria-label="Existing client job ID or torrent hash" placeholder="Job ID / torrent hash" value={externalRef} disabled={busy} onChange={e => setExternalRef(e.target.value)} />
    <div className="form-row">
      <button disabled={!verified || !externalRef.trim() || busy} onClick={() => resolve('attach')}>Link existing job</button>
      <button className="secondary" disabled={!verified || busy} onClick={() => resolve('notSubmitted')}>Verified not submitted · release slot</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </details>;
}

export default function QueuePage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const queue = useQuery({ queryKey: ['queue'], queryFn: api.queue.list, refetchInterval: 3000 });
  const active = queue.data?.filter(item => item.status !== 'failed')
    .sort((a, b) => Number(a.status === 'queued') - Number(b.status === 'queued')) ?? [];
  const waiting = active.filter(item => item.status === 'queued');
  async function move(id: number, direction: 'up' | 'down' | 'top' | 'bottom') {
    setMoving(true);
    try { await api.queue.move(id, direction); setSummary('Queue order updated.'); }
    catch (error) { setSummary(`Could not reorder: ${(error as Error).message}`); }
    finally { await queryClient.invalidateQueries({ queryKey: ['queue'] }); setMoving(false); }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { const result = await api.queue.refresh();
    setSummary(`${result.staged ?? 0} transfers ready for processing, ${result.completed} imported, ${result.failed} failed, ${result.pending} pending`);
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
        {' '}Move waiting downloads up, down, to the top or to the bottom. Active downloads keep running.
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
              <th>Next step</th>
              <th>Queue order</th>
            </tr>
          </thead>
          <tbody>
            {active.map((item) => (
              <tr key={item.id}>
                <td>{item.musicVideo.artist.name}</td>
                <td>{item.musicVideo.title}</td>
                <td>{item.sourceType}<br /><small>{item.validationCategory === 'canonical' ? 'Canonical source' : 'Supplementary / additional'}</small></td>
                <td>{item.quality ?? '—'}</td>
                <td>{downloadStage(item)}</td>
                <td>{item.status === 'importing' ? 'Transfer complete' : `${Math.round(item.progress * 100)}%`}
                  {item.stageTimings && <details><summary>Timings</summary>{formatDownloadTimings(item.stageTimings)}</details>}
                </td>
                <td>{item.error ?? '—'}</td>
                <td>{item.status === 'submissionUnknown' ? <ReconcileSubmission id={item.id} onDone={message => {
                  setSummary(message); queryClient.invalidateQueries({ queryKey: ['queue'] }); queryClient.invalidateQueries({ queryKey: ['queueResults'] });
                }} /> : <Link to={`/artist/${item.musicVideo.artist.id}`}>Video details</Link>}</td>
                <td>{item.status === 'queued' && <div className="form-row">
                  <button disabled={moving || waiting[0]?.id === item.id} onClick={() => move(item.id, 'top')}>Move to top</button>
                  <button disabled={moving || waiting[0]?.id === item.id} onClick={() => move(item.id, 'up')}>Move up</button>
                  <button disabled={moving || waiting[waiting.length - 1]?.id === item.id} onClick={() => move(item.id, 'down')}>Move down</button>
                  <button disabled={moving || waiting[waiting.length - 1]?.id === item.id} onClick={() => move(item.id, 'bottom')}>Move to bottom</button>
                </div>}</td>
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

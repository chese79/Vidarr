import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { downloadStage } from './downloadStage';

export default function DownloadProgress() {
  const client = useQueryClient();
  const lastError = useRef(client.getQueryState(['queue'])?.error);
  const queue = useQuery({ queryKey: ['queue'], queryFn: api.queue.list, refetchInterval: 3000 });
  if (queue.error) lastError.current = queue.error;
  if (queue.isSuccess) lastError.current = null;
  const active = queue.data?.filter(item => ['downloading', 'importing'].includes(item.status)) ?? [];
  const waiting = queue.data?.filter(item => item.status === 'queued').length ?? 0;
  const unresolved = queue.data?.filter(item => item.status === 'submissionUnknown').length ?? 0;
  const unavailable = Boolean(lastError.current);
  const loading = queue.isPending && !unavailable;
  if (!active.length && !waiting && !unresolved && !loading && !unavailable) return null;
  return <section className="download-progress" aria-label="Active downloads">
    <Link to="/queue">Downloads · {active.filter(item => item.status === 'downloading').length} transferring · {active.filter(item => item.status === 'importing').length} processing</Link>
    {loading && <small role="status">Loading download updates…</small>}
    {active.map(item => {
      const progress = Math.max(0, Math.min(1, item.progress));
      const label = `${item.musicVideo.artist.name} — ${item.musicVideo.title}`;
      return <div key={item.id} className="download-progress-item">
        <span title={label}>{label}</span>
        <progress aria-label={label} aria-valuetext={downloadStage(item)} max={1} value={item.status === 'downloading' ? progress : undefined} />
        <small>{downloadStage(item)}{item.status === 'downloading' ? ` · ${Math.round(progress * 100)}%` : ''}</small>
      </div>;
    })}
    {waiting > 0 && <small>{waiting} video{waiting === 1 ? '' : 's'} waiting</small>}
    {unresolved > 0 && <Link to="/queue">{unresolved} submission{unresolved === 1 ? '' : 's'} need reconciliation</Link>}
    {unavailable && <small role="status">Download updates unavailable</small>}
  </section>;
}

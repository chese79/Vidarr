import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function DownloadProgress() {
  const queue = useQuery({ queryKey: ['queue'], queryFn: api.queue.list, refetchInterval: 3000 });
  const active = queue.data?.filter(item => ['downloading', 'importing'].includes(item.status)) ?? [];
  const waiting = queue.data?.filter(item => item.status === 'queued').length ?? 0;
  if (!active.length && !waiting) return null;
  return <section className="download-progress" aria-label="Active downloads">
    <Link to="/queue">Downloads · {active.length} active</Link>
    {active.map(item => {
      const progress = Math.max(0, Math.min(1, item.progress));
      const label = `${item.musicVideo.artist.name} — ${item.musicVideo.title}`;
      return <div key={item.id} className="download-progress-item">
        <span title={label}>{label}</span>
        <progress aria-label={label} max={1} value={progress} />
        <small>{item.status === 'importing' ? 'Importing' : `${Math.round(progress * 100)}%`}</small>
      </div>;
    })}
    {waiting > 0 && <small>{waiting} video{waiting === 1 ? '' : 's'} waiting</small>}
    {queue.isError && <small role="status">Download updates unavailable</small>}
  </section>;
}

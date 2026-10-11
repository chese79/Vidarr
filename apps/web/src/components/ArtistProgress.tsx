import { Link } from 'react-router-dom';

export function isNewArtist(addedAt?: string, now = Date.now()): boolean {
  const added = addedAt ? Date.parse(addedAt) : NaN;
  return Number.isFinite(added) && added <= now && now - added < 7 * 24 * 60 * 60_000;
}

export function NewArtistBadge({ addedAt }: { addedAt?: string }) {
  return isNewArtist(addedAt) ? <span className="status-chip new-artist" title={`Added ${new Date(addedAt!).toLocaleString()}`}>New</span> : null;
}

export function sourceCheckLabel(status?: string): string {
  switch (status) {
    case 'running': return 'Collecting video sources…';
    case 'partial': return 'Some sources failed — automatic retry scheduled';
    case 'failed': return 'Source check failed — automatic retry scheduled';
    case 'complete': return 'Source check complete';
    default: return 'Source check queued';
  }
}

export function ArtistProgress({ id, status, pending, error }: { id: number; status?: string; pending: number; error?: string | null }) {
  return <span className="artist-meta" title={error ?? undefined}>
    {sourceCheckLabel(status)}
    {pending > 0 && <> · <Link to={`/video-review?artistId=${id}`}>{pending} videos need review</Link></>}
    {(status === 'partial' || status === 'failed') && <> · <Link to={`/artist/${id}`}>Review / retry sources</Link></>}
  </span>;
}

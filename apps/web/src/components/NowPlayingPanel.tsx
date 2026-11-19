import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { CatalogLink } from './CatalogMode';

export default function NowPlayingPanel() {
  const query = useQuery({ queryKey: ['nowPlaying'], queryFn: api.system.nowPlaying, refetchInterval: 5000 });
  if (query.isPending) return null;
  if (query.isError) return <p role="status">Playback status unavailable. <Link to="/system">System / Tasks</Link></p>;
  const data = query.data;
  if (!data.enabled) return <p role="status">Playback monitoring is disabled. <Link to="/system">System / Tasks</Link></p>;
  if (!data.items.length) return data.stale ? <p role="status">Waiting for current playback status…</p> : null;
  return <section aria-label="Now playing" className="card now-playing">
    <strong>{data.stale ? 'Last seen playing' : 'Now playing'}</strong>
    {data.stale && <span role="status"> Playback status is unavailable; showing the last observed video.</span>}
    {data.items.map(item => <div key={item.id} className="form-row" style={{ marginBottom: 0, alignItems: 'center' }}>
      <span>{item.artistName ? `${item.artistName} — ` : ''}{item.title}{!item.playing && ' · Paused'}</span>
      <small>{[item.deviceName, item.userName, item.connectorName].filter(Boolean).join(' · ')}</small>
      {data.stale && <small>Last observed {new Date(item.lastSeenAt).toLocaleString()}</small>}
      {item.recordingId ? <CatalogLink catalog="live" to={`/live/recording/${item.recordingId}`}>Manage recording</CatalogLink>
        : item.musicVideoId && item.artistId && item.catalogKind !== 'liveClassified'
          ? <CatalogLink catalog="musicVideos" to={`/artist/${item.artistId}#video-${item.musicVideoId}`} aria-label={`Manage now playing video ${item.title}`}>Manage video</CatalogLink>
          : item.artistId && item.catalogKind === 'liveClassified'
            ? <CatalogLink catalog="live" to={`/artist/${item.artistId}/live`}>Open artist Live library</CatalogLink>
            : <Link to="/library-connectors">Review library match</Link>}
    </div>)}
  </section>;
}

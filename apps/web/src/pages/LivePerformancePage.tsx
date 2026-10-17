import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RecordingCoverage, type CreateRecordingCandidate } from '@vidarr/shared-types';
import { api } from '../api/client';
import { liveLabels, RecordingRow } from './LivePage';
import LiveMetadataEditor from '../components/LiveMetadataEditor';

export default function LivePerformancePage() {
  const id = Number(useParams().id);
  const client = useQueryClient();
  const performance = useQuery({ queryKey: ['live-performance', id], queryFn: () => api.live.performance(id) });
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [coverage, setCoverage] = useState<CreateRecordingCandidate['claimedCoverage']>('unknown');
  const create = useMutation({ mutationFn: api.live.createRecording, onSuccess: () => {
    setTitle(''); setUrl(''); client.invalidateQueries({ queryKey: ['live-performance', id] });
    client.invalidateQueries({ queryKey: ['live-recordings'] }); client.invalidateQueries({ queryKey: ['live-performances'] });
  } });
  if (performance.isLoading) return <p>Loading…</p>;
  if (performance.isError) return <p role="alert">{performance.error.message}</p>;
  if (!performance.data) return null;
  const row = performance.data;
  return <>
    <p><Link to={`/artist/${row.artistId}/live`}>{row.artist.name} / Live</Link></p>
    <h2>{row.title}</h2>
    <p>{row.performanceDate ?? 'Date unknown'} · {[row.venue, row.city].filter(Boolean).join(', ') || 'Place unknown'}</p>
    <p>{liveLabels[row.setting]} · {liveLabels[row.style]} · Independent identity</p>
    <p>Recording unknown. Candidate metadata does not establish an eligible video, ownership or complete coverage.</p>
    {row.notes && <p>{row.notes}</p>}
    <LiveMetadataEditor key={row.revision} performance={row} onSaved={() => {
      client.invalidateQueries({ queryKey: ['live-performance', id] });
      client.invalidateQueries({ queryKey: ['live-performances'] });
      client.invalidateQueries({ queryKey: ['live-recordings'] });
    }} />
    <h3>Song occurrences</h3>
    <p>Known order; setlist completeness and recording coverage are unverified.</p>
    <ol>{row.songs.map(song => <li key={song.id}>{song.title}{song.section && ` (${song.section})`} · {song.kind}</li>)}</ol>
    <h3>Recording candidates ({row._count.recordings})</h3>
    {row._count.recordings > 25 && <p>Showing the latest 25. <Link to="/live?view=recordings">Browse recordings</Link>.</p>}
    {row.recordings.map(link => <RecordingRow key={link.recording.id} recording={link.recording} />)}
    <form className="card" onSubmit={event => { event.preventDefault(); create.mutate({ title, performanceIds: [id], evidenceUrl: url.trim() || null, claimedCoverage: coverage }); }}>
      <h3>Add recording evidence</h3>
      <p>Retains a candidate for later identity/content review. This does not download, validate or register ownership.</p>
      <label>Recording title <input required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Evidence URL <input type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
      <label>Claimed coverage <select value={coverage} onChange={e => setCoverage(e.target.value as typeof coverage)}>{RecordingCoverage.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
      {create.isError && <p role="alert">{create.error.message}</p>}
      <button disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save candidate'}</button>
    </form>
  </>;
}

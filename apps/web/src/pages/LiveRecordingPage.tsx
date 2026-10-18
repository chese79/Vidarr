import LivePlaybackActions from '../components/LivePlaybackActions';
import LiveRecordingTools from '../components/LiveRecordingTools';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function LiveRecordingPage() {
  const id = Number(useParams().id), cache = useQueryClient();
  const recording = useQuery({ queryKey: ['live-recording', id], queryFn: () => api.live.recording(id), refetchInterval: 5000 });
  const [videoVerified, setVerified] = useState(false), [notes, setNotes] = useState(''), [url, setUrl] = useState('');
  const [performanceId, setPerformance] = useState(''), [sourceId, setSource] = useState(''), [clientId, setClient] = useState('');
  const [packSize, setPackSize] = useState(''), [contents, setContents] = useState(''), [selected, setSelected] = useState(''), [packApproved, setPackApproved] = useState(false);
  const [audio, setAudio] = useState(''), [visual, setVisual] = useState(''), [completeness, setCompleteness] = useState(''), [assessed, setAssessed] = useState(false);
  const [eventSearch, setEventSearch] = useState('');
  const events = useQuery({ queryKey: ['live-review-events', eventSearch], queryFn: () => api.live.performances(`search=${encodeURIComponent(eventSearch)}`), enabled: eventSearch.length > 1 });
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteScope, setDeleteScope] = useState('recording'), [deleteSong, setDeleteSong] = useState('');
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const [startPart, setStartPart] = useState(1);
  const [partId, setPart] = useState(''), [songId, setSong] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const clients = useQuery({ queryKey: ['downloadclients'], queryFn: api.downloadClients.list });
  const retry = useMutation({ mutationFn: ({ queueId, mode }: { queueId: number; mode: 'retryStaged' | 'retryDirect' }) => api.queue.retry(queueId, mode),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['live-recording', id] }) });
  const action = useMutation({ mutationFn: ({ path, data, method }: { path: string; data: unknown; method?: string }) => api.live.action(path, data, method),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['live-recording', id] }); cache.invalidateQueries({ queryKey: ['live-performance'] }); } });
  if (recording.isPending) return <p>Loading recording…</p>;
  if (recording.isError) return <p role="alert">{recording.error.message}</p>;
  const row = recording.data;
  const targetId = Number(performanceId || row.performances[0]?.performance.id);
  const run = (path: string, data: unknown, method?: string) => action.mutate({ path, data, method });
  return <>
    <Link to="/live?view=recordings">Live recordings</Link><h2>{row.title}</h2>
    <p>{row.reviewStatus} · {row.origin} · Claimed coverage: {row.claimedCoverage}</p>
    <label>Recording origin <select value={row.origin} onChange={e => run(`recordings/${id}/metadata`, { origin: e.target.value }, 'PATCH')}><option value="unknown">Unknown</option><option value="professional">Professional</option><option value="audience">Audience</option></select></label>
    <label>Recording coverage claim <select value={row.claimedCoverage} onChange={e => run(`recordings/${id}/metadata`, { claimedCoverage: e.target.value }, 'PATCH')}><option value="unknown">Unknown</option><option value="entirePerformance">Entire performance</option><option value="severalSongs">Several songs</option><option value="individualSong">Individual song</option><option value="excerpt">Excerpt</option></select></label>
    {row.performances.map(link => <p key={link.performance.id}><Link to={`/live/performance/${link.performance.id}`}>{link.performance.artist.name}: {link.performance.title}</Link></p>)}
    {action.isError && <p role="alert">{action.error.message}</p>}{action.isSuccess && <p role="status">Saved.</p>}
    {row.evidenceUrl && <p><a target="_blank" rel="noreferrer" href={row.evidenceUrl}>Open original evidence</a></p>}
    <details><summary>Original evidence and review history</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{row.evidence}</pre></details>
    <section className="card"><h3>Identity and content review</h3>
      <label>Find another event or artist <input value={eventSearch} onChange={e => setEventSearch(e.target.value)} placeholder="Artist, venue or event title" /></label>
      <p>Check the performer, performance date, place and songs against the linked event. Upload and broadcast dates may differ. Only moving video is eligible; audio-only and static-image uploads are excluded.</p>
      <label>Linked performance <select value={performanceId || String(targetId)} onChange={e => setPerformance(e.target.value)}>{[...new Map([...row.performances.map(link => link.performance), ...(events.data?.items ?? [])].map(event => [event.id, event])).values()].map(event => <option key={event.id} value={event.id}>{event.artist.name} · {event.performanceDate ?? 'Date unknown'} · {event.title} · {event.venue}</option>)}</select></label>
      <label><input type="checkbox" checked={videoVerified} onChange={e => setVerified(e.target.checked)} /> I verified the artist/performance identity and actual moving video</label>
      <label>Evidence and unresolved details <textarea value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <button disabled={action.isPending || !videoVerified} onClick={() => run(`recordings/${id}/review`, { action: 'confirm', performanceId: targetId, videoVerified, notes })}>Confirm match</button>{' '}
      <button disabled={action.isPending || !videoVerified} onClick={() => run(`recordings/${id}/review`, { action: 'independent', performanceId: targetId, videoVerified, notes })}>Keep independent</button>{' '}
      <button className="secondary" disabled={action.isPending} onClick={() => run(`recordings/${id}/review`, { action: 'reject', performanceId: targetId, videoVerified: false, notes })}>Reject candidate</button>
    </section>
    <section className="card"><h3>Sources and acquisition</h3>
      <p>Review a source before choosing Download. Live downloads use the shared Queue and the validation policy saved when processing begins.</p>
      <form onSubmit={e => { e.preventDefault(); run(`recordings/${id}/sources`, { url, accepted: true }); }}>
        <label>Reviewed YouTube or Vimeo video URL <input type="url" required value={url} onChange={e => setUrl(e.target.value)} /></label><button disabled={action.isPending}>Add reviewed source</button>
      </form>
      {row.sources.map(source => <details key={source.id}><summary>{source.provider} source evidence</summary>{!source.provider.startsWith('indexer:') && <button disabled={action.isPending} onClick={() => run(`sources/${source.id}/inspect`, {})}>Inspect source dates and candidate chapters</button>}<pre style={{ whiteSpace: 'pre-wrap' }}>{source.payload}</pre><button disabled={action.isPending} onClick={() => run(`sources/${source.id}`, { accepted: !source.accepted }, 'PATCH')}>{source.accepted ? 'Withdraw source acceptance' : 'Accept reviewed source'}</button></details>)}
      <label>Download source <select value={sourceId} onChange={e => setSource(e.target.value)}><option value="">Choose source</option>{row.sources.filter(source => source.accepted).map(source => <option key={source.id} value={source.id}>{source.provider}: {source.url}</option>)}</select></label>
      <label>Download client for indexer sources <select value={clientId} onChange={e => setClient(e.target.value)}><option value="">Direct download</option>{clients.data?.filter(client => client.enabled).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      {clientId && <details><summary>Full pack approval</summary><p>Current clients do not guarantee selective downloads. Confirm the complete download size and contents; only the selected files will be imported.</p>
        <label>Total size in bytes <input type="number" min="1" value={packSize} onChange={e => setPackSize(e.target.value)} /></label>
        <label>Complete pack contents, relative paths in order <textarea value={contents} onChange={e => setContents(e.target.value)} /></label>
        <label>Files to import, in performance order <textarea value={selected} onChange={e => setSelected(e.target.value)} /></label>
        <label><input type="checkbox" checked={packApproved} onChange={e => setPackApproved(e.target.checked)} /> Approve downloading the full pack at this size</label>
      </details>}
      <label>Import starting at part <input type="number" min="1" max="500" value={startPart} onChange={e => setStartPart(Number(e.target.value))} /></label>
      <button disabled={action.isPending || !sourceId || !row.identityVerified || !row.videoVerified || (!!clientId && !packApproved)} onClick={() => run(`recordings/${id}/download`, {
        sourceId: Number(sourceId), partPosition: startPart, ...(clientId ? { downloadClientId: Number(clientId), packApproval: { totalSizeBytes: Number(packSize), contents: contents.split('\n').filter(Boolean), selected: selected.split('\n').filter(Boolean), approved: true } } : {}) })}>Download</button>{' '}<Link to="/queue">Open Queue</Link>
      {row.queueItems.map(item => <div key={item.id}><p>Queue #{item.id}: {item.status} {item.error}</p>{item.status === 'failed' && <>
        <button disabled={retry.isPending} onClick={() => retry.mutate({ queueId: item.id, mode: 'retryStaged' })}>Retry retained download</button>{' '}
        <button disabled={retry.isPending} onClick={() => retry.mutate({ queueId: item.id, mode: 'retryDirect' })}>Retry direct transfer if no file was retained</button></>}</div>)}
      {retry.isError && <p role="alert">{retry.error.message}</p>}
    </section>
    <LivePlaybackActions recordingId={id} performances={row.performances.map(link => link.performance)} />
    <LiveRecordingTools recording={row} />
    <section className="card"><h3>Files and verified song coverage</h3><p>Original files remain intact. A chapter start alone does not establish a complete song; confirm both boundaries and the full rendition.</p>
      {row.parts.map(part => <p key={part.id}>Part {part.position}: {part.durationSeconds ? `${Math.round(part.durationSeconds)} seconds` : 'Duration unknown'} · {part.serverCopies.some(copy => copy.available) ? 'Ready on playback server' : 'Imported; server confirmation pending'}</p>)}
      <form onSubmit={e => { e.preventDefault(); run(`parts/${partId}/coverage`, { songs: [{ songId: Number(songId), startSeconds: Number(start), endSeconds: Number(end), fullSong: true, verified: true }] }, 'PUT'); }}>
        <label>Part <select required value={partId} onChange={e => setPart(e.target.value)}><option value="">Choose part</option>{row.parts.map(part => <option key={part.id} value={part.id}>Part {part.position}</option>)}</select></label>
        <label>Song occurrence <select required value={songId} onChange={e => setSong(e.target.value)}><option value="">Choose the specific rendition</option>{row.performances.flatMap(link => link.performance.songs.map(song => <option key={song.id} value={song.id}>{link.performance.title}: {song.position}. {song.title}</option>))}</select></label>
        <label>Start seconds <input required type="number" min="0" value={start} onChange={e => setStart(e.target.value)} /></label><label>End seconds <input required type="number" min="1" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <button disabled={action.isPending}>Confirm full-song coverage</button>
      </form>
      <h4>Verified quality assessment</h4><p>Current resolution: {row.resolution ?? 'unknown'}p. Audio: {row.audioScore ?? 'unknown'}/10; visual: {row.visualScore ?? 'unknown'}/10; coverage: {row.verifiedCoverage ?? 'unknown'}%. Ratings are user assessments, not automatic sound or camera analysis.</p>
      <label>Verified coverage (%) <input type="number" min="0" max="100" value={completeness} onChange={e => setCompleteness(e.target.value)} /></label>
      <label>Audio quality (0–10) <input type="number" min="0" max="10" value={audio} onChange={e => setAudio(e.target.value)} /></label>
      <label>Visual quality (0–10) <input type="number" min="0" max="10" value={visual} onChange={e => setVisual(e.target.value)} /></label>
      <label><input type="checkbox" checked={assessed} onChange={e => setAssessed(e.target.checked)} /> I assessed these properties against the actual recording</label>
      <button disabled={!assessed || action.isPending} onClick={() => run(`recordings/${id}/preference`, { qualityVerified: true, ...(completeness ? { verifiedCoverage: Number(completeness) } : {}), ...(audio ? { audioScore: Number(audio) } : {}), ...(visual ? { visualScore: Number(visual) } : {}) }, 'PATCH')}>Save quality assessment</button>
      <label><input type="checkbox" checked={row.preferred} onChange={e => run(`recordings/${id}/preference`, { preferred: e.target.checked }, 'PATCH')} /> Preferred recording for playback</label>
      <label><input type="checkbox" checked={row.uninterruptedVerified} onChange={e => run(`recordings/${id}/preference`, { uninterruptedVerified: e.target.checked }, 'PATCH')} /> Verified entire continuous performance, including between-song material</label>
      <label><input type="checkbox" checked={row.pinned} onChange={e => run(`recordings/${id}/preference`, { pinned: e.target.checked }, 'PATCH')} /> Pin this recording against automatic upgrades</label>
    </section>
    <details className="card"><summary>Delete recording</summary><p>Local files and confirmed matched server copies are removed after five minutes. Playing or paused files and failures retry 40 minutes later. The performance and viewing history remain.</p>
      {settings.data?.excludeDeletedVideosFromScans && <><label>Exclude from future discovery <select value={deleteScope} onChange={e => setDeleteScope(e.target.value)}><option value="recording">This recording only</option><option value="rendition" disabled={row.claimedCoverage !== 'individualSong'}>This verified song rendition</option><option value="artistSet" disabled={row.performances.length !== 1}>This artist performance</option></select></label><p>This action deletes the selected recording’s files. Narrow scopes cannot delete a shared compilation file or turn a chapter into a clip.</p>{deleteScope === 'rendition' && <label>Song rendition <select value={deleteSong} onChange={e => setDeleteSong(e.target.value)}><option value="">Choose occurrence</option>{row.performances.flatMap(link => link.performance.songs.map(song => <option key={song.id} value={song.id}>{song.position}. {song.title}</option>))}</select></label>}</>}
      {(settings.data?.warnBeforeDelete ?? true) && <label><input type="checkbox" checked={deleteConfirmed} onChange={e => setDeleteConfirmed(e.target.checked)} /> Confirm deletion of this recording and its matched server copies</label>}
      <button disabled={((settings.data?.warnBeforeDelete ?? true) && !deleteConfirmed) || action.isPending || (deleteScope === 'rendition' && !deleteSong)} onClick={() => run(`recordings/${id}/delete`, { confirmed: deleteConfirmed || settings.data?.warnBeforeDelete === false, scope: deleteScope, ...(deleteSong ? { songId: Number(deleteSong) } : {}), ...(row.performances.length === 1 ? { performanceId: row.performances[0].performance.id } : {}) })}>Schedule deletion</button>
      {row.deletionState && <p>{row.deletionState}: {row.deletionError}</p>}
    </details>
  </>;
}

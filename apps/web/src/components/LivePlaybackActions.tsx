import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface PlaybackChoice { connectorId: number; libraryId: string; name: string; supported: boolean; explanation: string; clients: { id: string; name: string; userId: string }[] }
export default function LivePlaybackActions({ recordingId, performances }: { recordingId: number; performances: { id: number; title: string; songs: { id: number; title: string; position: number }[] }[] }) {
  const choices = useQuery({ queryKey: ['live-playback-options', recordingId], queryFn: () => api.live.read<PlaybackChoice[]>(`recordings/${recordingId}/playback`) });
  const [selection, setSelection] = useState(''), [viewingId, setViewing] = useState(''), [songId, setSong] = useState('');
  const [performanceId, setPerformance] = useState(String(performances[0]?.id ?? ''));
  const views = useQuery({ queryKey: ['live-viewings', Number(performanceId)], queryFn: () => api.live.read<Array<{ id: number; userId: string; positionSeconds: number; active: boolean }>>(`performances/${performanceId}/viewings`), enabled: !!performanceId });
  const start = useMutation({ mutationFn: () => {
    const [choiceIndex, clientIndex] = selection.split(':').map(Number), choice = choices.data![choiceIndex], client = choice.clients[clientIndex];
    return api.live.action(`recordings/${recordingId}/playback`, { connectorId: choice.connectorId, libraryId: choice.libraryId, sessionId: client.id, userId: client.userId,
      ...(viewingId ? { viewingId: Number(viewingId) } : {}), ...(songId ? { songId: Number(songId) } : {}) });
  } });
  return <section className="card"><h3>Play / resume</h3>
    <p>Select the playback client and its server user. Starting playback sends a command; watched time is credited only when playback observations arrive. A song jump starts at its verified boundary and continues through the recording.</p>
    <button onClick={() => choices.refetch()}>Refresh playback clients</button>
    {choices.data?.map((choice, index) => <p key={index}>{choice.name}: {choice.explanation}</p>)}
    <label>Playback client <select value={selection} onChange={e => setSelection(e.target.value)}><option value="">Choose an available client</option>{choices.data?.flatMap((choice, index) => choice.clients.map((client, clientIndex) => <option key={`${index}:${clientIndex}`} value={`${index}:${clientIndex}`}>{choice.name} · {client.name}</option>))}</select></label>
    {performances.length > 1 && <label>Performance <select value={performanceId} onChange={e => { setPerformance(e.target.value); setViewing(''); }}>
      {performances.map(performance => <option key={performance.id} value={performance.id}>{performance.title}</option>)}</select></label>}
    <label>Resume unfinished viewing <select value={viewingId} onChange={e => { setViewing(e.target.value); setSong(''); }}><option value="">Start at beginning</option>{views.data?.filter(view => view.active).map(view => <option key={view.id} value={view.id}>Viewer {view.userId} · {Math.floor(view.positionSeconds / 60)} minutes</option>)}</select></label>
    <label>Jump to a verified song boundary <select value={songId} onChange={e => { setSong(e.target.value); setViewing(''); }}><option value="">No song jump</option>{performances.flatMap(performance => performance.songs.map(song => <option key={song.id} value={song.id}>{performance.title}: {song.position}. {song.title}</option>))}</select></label>
    <button disabled={!selection || start.isPending} onClick={() => start.mutate()}>{songId ? 'Play from song (continues)' : viewingId ? 'Resume viewing' : 'Play ordered recording'}</button>
    {start.isSuccess && <p role="status">Playback command sent; waiting for the client to report playback.</p>}{(choices.error || start.error) && <p role="alert">{(choices.error ?? start.error)?.message}</p>}
    {choices.data?.length === 0 && <p>Confirm delivery to a playback server first.</p>}
  </section>;
}

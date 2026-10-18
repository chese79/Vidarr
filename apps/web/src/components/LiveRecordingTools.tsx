import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveRecordingDetail } from '@vidarr/shared-types';
import { api } from '../api/client';

export default function LiveRecordingTools({ recording }: { recording: LiveRecordingDetail }) {
  const cache = useQueryClient(), id = recording.id, navigate = useNavigate();
  const [root, setRoot] = useState(''), [path, setPath] = useState(''), [connector, setConnector] = useState('');
  const [search, setSearch] = useState(''), [submitted, setSubmitted] = useState(''), [offset, setOffset] = useState(0);
  const [playlist, setPlaylist] = useState(''), [part, setPart] = useState(''), [song, setSong] = useState(''), [fallback, setFallback] = useState(false);
  const [official, setOfficial] = useState(false);
  const [cleanupConfirmed, setCleanupConfirmed] = useState(false);
  const cleanup = useQuery({ queryKey: ['live-cleanup', id], queryFn: () => api.live.read<{ id: number; title: string }[]>(`recordings/${id}/cleanup`) });
  const roots = useQuery({ queryKey: ['rootfolders'], queryFn: api.rootFolders.list });
  const connectors = useQuery({ queryKey: ['libraryconnectors'], queryFn: api.libraryConnectors.list });
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const inventory = useQuery({ queryKey: ['live-server-candidates', connector, submitted, offset], enabled: !!connector && submitted.length > 1,
    queryFn: () => api.live.read<{ total: number; items: { externalId: string; title: string; path: string | null }[] }>(`server-candidates?connectorId=${connector}&search=${encodeURIComponent(submitted)}&offset=${offset}`) });
  const action = useMutation({ mutationFn: ({ route, data }: { route: string; data: unknown }) => api.live.action(route, data),
    onSuccess: (_data, variables) => { if (variables.route.endsWith('/return-to-music-videos')) navigate(`/artist/${recording.performances[0]?.performance.artist.id}`); cache.invalidateQueries({ queryKey: ['live-recording', id] }); cache.invalidateQueries({ queryKey: ['live-cleanup', id] }); cache.invalidateQueries({ queryKey: ['playlists'] }); } });
  const run = (route: string, data: unknown) => action.mutate({ route, data });
  return <>
    {!!cleanup.data?.length && <details className="card"><summary>Redundant recording cleanup</summary><p>This replacement is confirmed on the playback server. These older versions have no unique verified song coverage, playlist references or unfinished viewing. Deletion still waits five minutes and defers while playing.</p>
      <label><input type="checkbox" checked={cleanupConfirmed} onChange={e => setCleanupConfirmed(e.target.checked)} /> Confirm deletion of a selected older recording and its matched server copies</label>
      {cleanup.data.map(item => <p key={item.id}><Link to={`/live/recording/${item.id}`}>{item.title}</Link>{' '}<button disabled={!cleanupConfirmed || action.isPending} onClick={() => run(`recordings/${id}/cleanup`, { recordingId: item.id, confirmed: true })}>Schedule deletion of this older version</button></p>)}</details>}
    <details className="card"><summary>Register an existing recording</summary>
      <p>Complete identity and content review first. Local files are validated and registered in place. Server items must match an exact item in the selected library; registration does not create a local file.</p>
      <label>Configured media folder <select value={root} onChange={e => setRoot(e.target.value)}><option value="">Choose folder</option>{roots.data?.map(value => <option key={value.id} value={value.id}>{value.path}</option>)}</select></label>
      <form onSubmit={e => { e.preventDefault(); run(`recordings/${id}/register-local`, { rootFolderId: Number(root), path }); }}>
        <label>Existing video file path <input required value={path} onChange={e => setPath(e.target.value)} /></label><button disabled={!root || action.isPending}>Validate and register file</button>
      </form>
      <label>Playback connector <select value={connector} onChange={e => { setConnector(e.target.value); setOffset(0); setSubmitted(''); }}><option value="">Choose library</option>{connectors.data?.filter(value => value.enabled && ['jellyfin', 'plex'].includes(value.type)).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <form onSubmit={e => { e.preventDefault(); setOffset(0); setSubmitted(search); }}><label>Search server inventory <input minLength={2} required value={search} onChange={e => setSearch(e.target.value)} /></label><button disabled={!connector}>Find recordings</button></form>
      {inventory.isFetching && <p>Loading inventory…</p>}{inventory.isError && <p role="alert">{inventory.error.message}</p>}
      {inventory.data?.items.map(item => <p key={item.externalId}>{item.title} · {item.path ?? 'Path unavailable'}{' '}<button disabled={!root || !item.path || action.isPending} onClick={() => run(`recordings/${id}/register-server`, { rootFolderId: Number(root), connectorId: Number(connector), externalId: item.externalId })}>Confirm this server recording</button></p>)}
      {inventory.data && <p>{inventory.data.total} matches. <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>{' '}<button disabled={offset + 25 >= inventory.data.total} onClick={() => setOffset(offset + 25)}>Next</button></p>}
    </details>
    <details className="card"><summary>Add to a playlist</summary><p>Choose a static playlist bound to this recording’s playback library. Review the playlist and Push it to publish changes. Song boundaries do not create a separate clip.</p>
      <label>Playlist <select value={playlist} onChange={e => setPlaylist(e.target.value)}><option value="">Choose playlist</option>{playlists.data?.filter(value => value.kind === 'static').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label>Recording part <select value={part} onChange={e => { setPart(e.target.value); setSong(''); setFallback(false); }}><option value="">Choose part</option>{recording.parts.map(value => <option key={value.id} value={value.id}>Part {value.position}</option>)}</select></label>
      <label>Song occurrence <select value={song} onChange={e => { setSong(e.target.value); setFallback(false); }}><option value="">Whole recording part</option>{recording.performances.flatMap(link => link.performance.songs.filter(value => recording.parts.find(partValue => partValue.id === Number(part))?.coverage.some(coverage => coverage.songId === value.id && coverage.verified && coverage.fullSong)).map(value => <option key={value.id} value={value.id}>{link.performance.title}: {value.position}. {value.title}</option>))}</select></label>
      {!!song && <label><input type="checkbox" checked={fallback} onChange={e => setFallback(e.target.checked)} /> Allow the whole recording part when the playback server cannot publish bounded song segments</label>}
      <button disabled={!playlist || !part || action.isPending} onClick={() => run(`parts/${part}/playlist`, { playlistId: Number(playlist), ...(song ? { songId: Number(song) } : {}), fullRecordingFallback: fallback })}>Add for playlist review</button>{' '}<Link to="/playlists">Review and Push playlists</Link>
    </details>
    {recording.musicVideoId && <details className="card"><summary>Return to music videos</summary><p>Use this only to correct a classification mistake. Live performances, concerts, official audio, lyrics and visualizers remain excluded from the official music-video catalog.</p>
      <label><input type="checkbox" checked={official} onChange={e => setOfficial(e.target.checked)} /> I confirmed this is an eligible official song music video</label>
      <button disabled={!official || action.isPending} onClick={() => run(`recordings/${id}/return-to-music-videos`, { officialMusicVideoConfirmed: true })}>Return to music videos</button>
    </details>}
    {action.isPending && <p role="status">Processing…</p>}{action.isSuccess && <p role="status">Saved. {official && <Link to={`/artist/${recording.performances[0]?.performance.artist.id}`}>Open artist</Link>}</p>}{action.isError && <p role="alert">{action.error.message}</p>}
  </>;
}

import { LiveDiscoveryControls } from '../components/LiveControls';
import { useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LiveSetting, LiveStyle, type CreateLivePerformance, type RecordingCandidate } from '@vidarr/shared-types';
import { api } from '../api/client';

export const liveLabels: Record<string, string> = {
  concert: 'Concert', festival: 'Festival', televisionRadio: 'Television / radio', studioSession: 'Studio session', informalGathering: 'Informal gathering',
  acoustic: 'Acoustic', electric: 'Electric', mixed: 'Mixed', unknown: 'Unknown', entirePerformance: 'Entire performance', severalSongs: 'Several songs', individualSong: 'Individual song', excerpt: 'Excerpt',
};

export function RecordingRow({ recording }: { recording: RecordingCandidate }) {
  return <article className="card">
    <h3><Link to={`/live/recording/${recording.id}`}>{recording.title}</Link></h3>
    <p>{recording.reviewStatus} · {recording.origin} origin</p>
    <p>Claimed coverage: {liveLabels[recording.claimedCoverage]} · Coverage unverified</p>
    {recording.evidenceUrl && <p><a href={recording.evidenceUrl} target="_blank" rel="noreferrer">View source evidence</a></p>}
    <p>{recording.performances.map(({ performance }, index) => <span key={performance.id}>{index > 0 && ' · '}<Link to={`/live/performance/${performance.id}`}>{performance.artist.name}: {performance.title}</Link></span>)}</p>
    {recording.notes && <p>{recording.notes}</p>}
  </article>;
}

function AddPerformance({ artistId, onSaved }: { artistId?: number; onSaved: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const [selectedArtist, setArtist] = useState(artistId ? String(artistId) : '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [setting, setSetting] = useState<CreateLivePerformance['setting']>('concert');
  const [style, setStyle] = useState<CreateLivePerformance['style']>('unknown');
  const [songs, setSongs] = useState('');
  const artists = useQuery({ queryKey: ['live-artists', search, artistId], queryFn: () => api.live.artists(search, artistId) });
  const create = useMutation({ mutationFn: api.live.createPerformance, onSuccess: result => onSaved(result.id) });
  return <form className="card" onSubmit={event => {
    event.preventDefault();
    create.mutate({ artistId: Number(selectedArtist), title, performanceDate: date.trim() || null,
      venue: venue.trim() || null, city: city.trim() || null, setting, style,
      songs: songs.split('\n').map(song => song.trim()).filter(Boolean).map(song => ({ title: song })) });
  }}>
    <h3>Add an independent performance</h3>
    <p>Save known details without inventing an event match or recording. Unknown dates and places can stay blank. This does not start searches or downloads.</p>
    {!artistId && <label>Find Library artist <input value={search} onChange={e => { setSearch(e.target.value); setArtist(''); }} /></label>}
    <label>Artist <select required value={selectedArtist} onChange={e => setArtist(e.target.value)}><option value="">Choose a confirmed artist</option>
      {artists.data?.items.map(artist => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label>
    {artists.isError && <p role="alert">{artists.error.message}</p>}
    <p>Only existing MusicBrainz-confirmed Library artists are eligible. Search to narrow the first 25 matches.</p>
    <label>Performance title <input required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label>Performance date <input placeholder="YYYY, YYYY-MM or YYYY-MM-DD; unknown may stay blank" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label>Venue or public location label <input maxLength={300} value={venue} onChange={e => setVenue(e.target.value)} /></label>
    <label>City <input maxLength={300} value={city} onChange={e => setCity(e.target.value)} /></label>
    <label>Setting <select value={setting} onChange={e => setSetting(e.target.value as typeof setting)}>{LiveSetting.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
    <label>Style <select value={style} onChange={e => setStyle(e.target.value as typeof style)}>{LiveStyle.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
    <label>Known songs in performance order, one per line <textarea rows={6} value={songs} onChange={e => setSongs(e.target.value)} /></label>
    <p>Repeated songs remain separate occurrences. This list does not prove recording coverage or setlist completeness.</p>
    {create.isError && <p role="alert">{create.error.message}</p>}
    <button disabled={create.isPending || !selectedArtist || artists.isLoading}>{create.isPending ? 'Saving…' : 'Save performance'}</button>
  </form>;
}

export default function LivePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const artistId = id ? Number(id) : undefined;
  const [params, setParams] = useSearchParams();
  const recordings = params.get('view') === 'recordings';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const [adding, setAdding] = useState(false);
  const client = useQueryClient();
  const query = new URLSearchParams(params);
  query.delete('view'); query.set('offset', String(offset)); query.set('limit', '25');
  if (artistId) query.set('artistId', String(artistId));
  const performances = useQuery({ queryKey: ['live-performances', query.toString()], queryFn: () => api.live.performances(query.toString()), enabled: !recordings });
  const candidates = useQuery({ queryKey: ['live-recordings', query.toString()], queryFn: () => api.live.recordings(query.toString()), enabled: recordings });
  const page = recordings ? candidates.data : performances.data;
  const error = recordings ? candidates.error : performances.error;
  function change(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete('offset'); setParams(next); }
  return <>
    <h2>Live</h2><Link to="/live/settings">Live settings and monitoring</Link>{' · '}<Link to="/live/classification">Awaiting classification</Link>{artistId && <LiveDiscoveryControls artistId={artistId} />}
    {artistId && <nav aria-label="Artist catalog"><Link to={`/artist/${artistId}`}>Music Videos</Link> · <strong>Live</strong></nav>}
    <nav aria-label="Live views"><button aria-pressed={!recordings} onClick={() => change('view', '')}>Performances</button> <button aria-pressed={recordings} onClick={() => change('view', 'recordings')}>Recordings</button></nav>
    <p>Browse performances and recording versions. Identity review, verified coverage, acquisition and playback readiness remain distinct.</p>
    <div className="toolbar">
      <label>Search <input value={params.get('search') ?? ''} onChange={e => change('search', e.target.value)} /></label>
      <label>Setting <select value={params.get('setting') ?? ''} onChange={e => change('setting', e.target.value)}><option value="">All settings</option>{LiveSetting.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
      <label>Style <select value={params.get('style') ?? ''} onChange={e => change('style', e.target.value)}><option value="">All styles</option>{LiveStyle.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
      <button onClick={() => setAdding(value => !value)}>{adding ? 'Close form' : 'Add performance'}</button>
    </div>
    {adding && <AddPerformance key={artistId ?? 'all'} artistId={artistId} onSaved={savedId => { setAdding(false); client.invalidateQueries({ queryKey: ['live-performances'] }); navigate(`/live/performance/${savedId}`); }} />}
    {error && <p role="alert">{error.message}</p>}
    {(recordings ? candidates.isLoading : performances.isLoading) && <p>Loading…</p>}
    {page && <p>{page.total} {recordings ? 'recording candidates' : 'performances'}</p>}
    {!recordings && performances.data?.items.map(performance => <article className="card" key={performance.id}>
      <h3><Link to={`/live/performance/${performance.id}`}>{performance.title}</Link></h3>
      <p><Link to={`/artist/${performance.artistId}/live`}>{performance.artist.name}</Link> · {performance.performanceDate ?? 'Date unknown'} · {[performance.venue, performance.city].filter(Boolean).join(', ') || 'Place unknown'}</p>
      <p>{liveLabels[performance.setting]} · {liveLabels[performance.style]} · {performance.identityStatus} identity · {performance.recordingState}</p>
      <p>{performance._count.songs} song occurrences · {performance._count.recordings} recording versions</p>
    </article>)}
    {recordings && candidates.data?.items.map(recording => <RecordingRow key={recording.id} recording={recording} />)}
    {page && <div><button disabled={!offset} onClick={() => { const next = new URLSearchParams(params); next.set('offset', String(Math.max(0, offset - 25))); setParams(next); }}>Previous</button> <button disabled={offset + 25 >= page.total} onClick={() => { const next = new URLSearchParams(params); next.set('offset', String(offset + 25)); setParams(next); }}>Next</button></div>}
  </>;
}

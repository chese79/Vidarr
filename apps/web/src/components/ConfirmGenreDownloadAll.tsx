import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function ConfirmGenreDownloadAll({ artistId }: { artistId: number }) {
  const client = useQueryClient();
  const key = ['artistGenres', artistId];
  const view = useQuery({ queryKey: key, queryFn: () => api.artists.genres(artistId) });
  const [selection, setSelection] = useState<string[] | null>(null);
  const [typed, setTyped] = useState('');
  const selected = selection ?? view.data?.effective.map((g) => g.name) ?? [];
  const options = [...new Set([
    ...(view.data?.effective.map((g) => g.name) ?? []),
    ...(view.data?.alternatives.map((g) => g.name) ?? []),
    ...Object.values(view.data?.sources ?? {}).flatMap((rows) => rows.map((g) => g.name)),
    ...selected,
  ])].sort();
  const refresh = useMutation({
    mutationFn: () => api.artists.refreshGenres(artistId),
    onSuccess: (result) => client.setQueryData(key, result.view),
  });
  const download = useMutation({
    mutationFn: () => api.artists.confirmGenresDownloadAll(artistId, selected),
    onSuccess: () => {
      for (const queryKey of [['artists'], ['artist', artistId], key, ['artistSummary'], ['genreStats'], ['queue']]) client.invalidateQueries({ queryKey });
    },
  });
  const busy = download.isPending || refresh.isPending;
  return <section className="card" aria-label="Confirm genres and download artist videos">
    <h3>Confirm genres</h3>
    {view.isPending && <p role="status">Loading genres…</p>}
    {view.isError && <p role="alert">Could not load genres: {(view.error as Error).message}</p>}
    <div className="form-row">{options.map((name) => <label key={name}><input type="checkbox" disabled={busy} checked={selected.includes(name)} onChange={(e) => setSelection(e.target.checked ? [...selected, name] : selected.filter((g) => g !== name))} /> {name}</label>)}</div>
    <form className="form-row" onSubmit={(e) => { e.preventDefault(); const name = typed.trim().toLowerCase(); if (name) setSelection([...new Set([...selected, name])]); setTyped(''); }}>
      <input aria-label="Add genre for confirmation" placeholder="Add a genre" value={typed} maxLength={80} disabled={busy} onChange={(e) => setTyped(e.target.value)} />
      <button className="secondary" type="submit" disabled={!typed.trim() || busy}>Add genre</button>
      <button className="secondary" type="button" disabled={busy} onClick={() => refresh.mutate()}>Refresh genres from sources</button>
    </form>
    <button disabled={!selected.length || busy || !view.isSuccess} onClick={() => download.mutate()}>{download.isPending ? 'Collecting sources and downloading…' : 'Confirm Genre & Add All'}</button>
    <p className="empty-state">Save the checked genres, monitor this artist and every catalog video, and search/download missing videos. Owned videos and active downloads are skipped. This also re-enables previously ignored catalog videos.</p>
    {download.isSuccess && <p role="status">{download.data.monitoredCount} videos monitored; {download.data.grabbed} downloads submitted; {download.data.skipped} searches need retry. {download.data.sourceErrors.join(' ')}</p>}
    {download.data?.failures.length ? <ul>{download.data.failures.map((failure) => <li key={failure.musicVideoId}>Video {failure.musicVideoId}: {failure.reason}</li>)}</ul> : null}
    {(download.isError || refresh.isError) && <p role="alert">{((download.error ?? refresh.error) as Error).message}</p>}
  </section>;
}

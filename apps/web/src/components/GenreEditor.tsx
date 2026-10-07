import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtistGenreView, GenreSourceName } from '@vidarr/shared-types';
import { api } from '../api/client';

const SOURCE_LABEL: Record<GenreSourceName, string> = {
  user: 'You',
  connector: 'Media server',
  embedded: 'File tags',
  musicbrainz: 'MusicBrainz',
  lastfm: 'Last.fm',
};

// "12 of 80 artists (15%)" — how common a genre is in the library, shown beside
// every genre so the user can tell a mainstream label from a one-off before
// deciding to keep or replace it.
export function formatGenreUsage(count: number, percent: number, total: number): string {
  if (total === 0) return 'No library artists yet';
  return `${count} of ${total} artist${total === 1 ? '' : 's'} (${percent}%)`;
}

const refreshOutcomeText: Record<string, string> = {
  updated: 'updated',
  'unchanged-empty': 'returned nothing new',
  'not-configured': 'not set up',
  skipped: 'skipped',
  failed: 'failed',
};

function GenreChip({ item, total, onRemove }: {
  item: ArtistGenreView['effective'][number];
  total: number;
  onRemove: () => void;
}) {
  return (
    <li className="genre-chip" title={item.parent ? `Part of ${item.parent}` : undefined}>
      <span className="genre-chip-name">{item.name}</span>
      <span className="genre-chip-meta">{formatGenreUsage(item.artistCount, item.percentOfArtists, total)}</span>
      <span className="genre-chip-meta">{item.sources.map((s) => SOURCE_LABEL[s]).join(' + ')}</span>
      <button type="button" className="genre-chip-remove" aria-label={`Remove ${item.name}`} onClick={onRemove}>×</button>
    </li>
  );
}

export default function GenreEditor({ artistId }: { artistId: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const key = ['artistGenres', artistId];

  const view = useQuery({ queryKey: key, queryFn: () => api.artists.genres(artistId) });

  // Every edit goes through one call that replaces the user's explicit list, so
  // the page never has to reason about which source a single chip came from.
  const save = useMutation({
    mutationFn: (genres: string[]) => api.artists.updateGenres(artistId, genres),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      queryClient.invalidateQueries({ queryKey: ['genreStats'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const refresh = useMutation({
    mutationFn: () => api.artists.refreshGenres(artistId),
    onSuccess: (result) => {
      queryClient.setQueryData(key, result.view);
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      queryClient.invalidateQueries({ queryKey: ['genreStats'] });
      setMessage(`MusicBrainz ${refreshOutcomeText[result.musicbrainz]}; Last.fm ${refreshOutcomeText[result.lastfm]}.`);
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const matchSpotify = useMutation({
    mutationFn: () => api.artists.matchGenre(artistId),
    onSuccess: (result) => {
      setMessage(`Matched "${result.genre}" via ${result.source}`);
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  if (view.isLoading) return <p className="empty-state" role="status">Loading genres…</p>;
  if (view.error || !view.data) return <p className="empty-state" role="alert">Genres unavailable: {(view.error as Error | null)?.message ?? 'unknown error'}</p>;

  const data = view.data;
  const names = data.effective.map((g) => g.name);
  const genres = data.effective.filter((g) => g.level === 'genre');
  const subgenres = data.effective.filter((g) => g.level === 'subgenre');
  const busy = save.isPending || refresh.isPending;
  const add = (name: string) => {
    const value = name.trim();
    if (!value) return;
    setDraft('');
    setMessage(null);
    save.mutate([...names, value]);
  };
  const remove = (name: string) => { setMessage(null); save.mutate(names.filter((n) => n !== name)); };
  const sourceEntries = (Object.entries(data.sources) as Array<[GenreSourceName, ArtistGenreView['sources'][GenreSourceName]]>)
    .filter(([, items]) => items.length);

  return (
    <section className="card genre-editor" aria-label="Genres">
      <div className="page-header">
        <div>
          <h3>Genres</h3>
          <p className="empty-state" style={{ padding: 0 }}>
            {data.userOverride
              ? 'Your edits are in force; automatic sources only add suggestions.'
              : 'Chosen automatically from MusicBrainz and Last.fm. Edit to set your own.'}
          </p>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <button type="button" className="secondary" onClick={() => refresh.mutate()} disabled={busy}>
            {refresh.isPending ? 'Refreshing…' : 'Refresh from sources'}
          </button>
          <button type="button" className="secondary" onClick={() => matchSpotify.mutate()} disabled={busy || matchSpotify.isPending}>
            {matchSpotify.isPending ? 'Matching…' : 'Match from Spotify'}
          </button>
          {data.userOverride && (
            <button type="button" className="secondary" onClick={() => { setMessage(null); save.mutate([]); }} disabled={busy}>
              Reset to automatic
            </button>
          )}
        </div>
      </div>

      <h4 className="genre-heading">Genres</h4>
      {genres.length ? <ul className="genre-chips">{genres.map((g) => <GenreChip key={g.name} item={g} total={data.totalArtists} onRemove={() => remove(g.name)} />)}</ul>
        : <p className="empty-state" style={{ padding: 0 }}>No broad genre set.</p>}
      <h4 className="genre-heading">Sub-genres</h4>
      {subgenres.length ? <ul className="genre-chips">{subgenres.map((g) => <GenreChip key={g.name} item={g} total={data.totalArtists} onRemove={() => remove(g.name)} />)}</ul>
        : <p className="empty-state" style={{ padding: 0 }}>No sub-genre set.</p>}

      <form className="form-row" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
        <label htmlFor="genre-add" className="sr-only">Add a genre or sub-genre</label>
        <input
          id="genre-add"
          list="genre-add-options"
          placeholder="Add a genre or sub-genre"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <datalist id="genre-add-options">{data.alternatives.map((a) => <option key={a.name} value={a.name} />)}</datalist>
        <button type="submit" disabled={busy || !draft.trim()}>Add</button>
      </form>

      {data.alternatives.length > 0 && (
        <>
          <h4 className="genre-heading">Alternatives</h4>
          <ul className="genre-chips" aria-label="Alternative genres">
            {data.alternatives.map((a) => (
              <li key={a.name} className="genre-chip genre-chip-alt">
                <button type="button" className="genre-chip-add" onClick={() => add(a.name)} disabled={busy} aria-label={`Add ${a.name}`}>+ {a.name}</button>
                <span className="genre-chip-meta">{a.level === 'subgenre' ? 'sub-genre' : 'genre'} · {formatGenreUsage(a.artistCount, a.percentOfArtists, data.totalArtists)}</span>
                <span className="genre-chip-meta">{a.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {sourceEntries.length > 0 && (
        <details className="genre-sources">
          <summary>What each source says</summary>
          {sourceEntries.map(([source, items]) => (
            <p key={source}>
              <strong>{SOURCE_LABEL[source]}:</strong>{' '}
              {items.map((i) => `${i.name}${i.votes ? ` (${i.votes})` : ''}${i.inEffect ? ' ✓' : ''}`).join(', ')}
            </p>
          ))}
          <p className="empty-state" style={{ padding: 0 }}>✓ = in force. MusicBrainz shows community votes; Last.fm shows tag weight out of 100.</p>
        </details>
      )}
      {data.refreshedAt && <p className="empty-state" style={{ padding: 0 }}>Sources last refreshed {new Date(data.refreshedAt).toLocaleString()}.</p>}
      {message && <p className="empty-state" role="status" style={{ padding: 0 }}>{message}</p>}
    </section>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { GenreStats } from '@vidarr/shared-types';
import { api } from '../api/client';

const THRESHOLDS = [1, 2, 3, 5, 10];

function libraryLink(genre: string) {
  return `/?genre=${encodeURIComponent(genre)}`;
}

export function GenreStatsView({ stats, threshold, onThreshold }: {
  stats: GenreStats;
  threshold: number;
  onThreshold: (value: number) => void;
}) {
  const { consolidation } = stats;
  const nothingToConsolidate = !consolidation.variantGroups.length && !consolidation.smallSubgenres.length;

  return (
    <>
      <p className="empty-state" style={{ padding: 0 }}>
        {stats.artistsWithGenre} of {stats.totalArtists} Library artist{stats.totalArtists === 1 ? '' : 's'} have a genre.
        Percentages are of all Library artists, so a genre that looks small here is small in your collection.
        An artist counts once under each genre or sub-genre it has, and counts under a broad genre when it has any of that genre&apos;s sub-genres.
      </p>

      {stats.genres.length === 0 && <p className="empty-state">No genres yet. Open an artist and refresh its genres, or let the background job fill them in.</p>}

      <div className="genre-stat-list">
        {stats.genres.map((genre) => (
          <details key={genre.name} className="genre-stat card" open={genre.subgenres.length <= 6 && stats.genres.length <= 6}>
            <summary>
              <span className="genre-stat-name">{genre.isOther ? 'Other (no broad genre)' : genre.name}</span>
              <span className="genre-stat-figure"><strong>{genre.artistCount}</strong> artist{genre.artistCount === 1 ? '' : 's'}</span>
              <span className="genre-stat-figure">{genre.percentOfArtists}% of library</span>
              <span className="genre-stat-figure">{genre.percentOfGenred}% of genred artists</span>
              <span className="genre-stat-figure">{genre.subgenres.length} sub-genre{genre.subgenres.length === 1 ? '' : 's'}</span>
            </summary>
            {!genre.isOther && (
              <p className="empty-state" style={{ padding: '4px 0' }}>
                {genre.directArtistCount} tagged &quot;{genre.name}&quot; directly
                {genre.directArtistCount > 0 && <> · <Link to={libraryLink(genre.name)}>Show in Library</Link></>}
              </p>
            )}
            {genre.subgenres.length > 0 ? (
              <table>
                <thead><tr><th>Sub-genre</th><th>Artists</th><th>% of library</th><th>% of {genre.isOther ? 'other' : genre.name}</th><th><span className="sr-only">Library</span></th></tr></thead>
                <tbody>
                  {genre.subgenres.map((sub) => (
                    <tr key={sub.name}>
                      <td>{sub.name}</td>
                      <td>{sub.artistCount}</td>
                      <td>{sub.percentOfArtists}%</td>
                      <td>{sub.percentOfParent}%</td>
                      <td><Link to={libraryLink(sub.name)}>Show in Library</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="empty-state" style={{ padding: '4px 0' }}>No sub-genres.</p>}
          </details>
        ))}
      </div>

      <section className="card" aria-label="Consolidation hints">
        <div className="page-header">
          <div>
            <h3>Worth consolidating?</h3>
            <p className="empty-state" style={{ padding: 0 }}>
              Hints only — nothing here changes your data. Edit an artist&apos;s genres to apply a change.
            </p>
          </div>
          <label className="form-row" style={{ alignItems: 'center', marginBottom: 0 }}>
            <span>Small means used by at most</span>
            <select value={threshold} onChange={(e) => onThreshold(Number(e.target.value))} aria-label="Small sub-genre threshold">
              {THRESHOLDS.map((n) => <option key={n} value={n}>{n} artist{n === 1 ? '' : 's'}</option>)}
            </select>
          </label>
        </div>
        {nothingToConsolidate && <p className="empty-state" style={{ padding: 0 }}>Nothing stands out — no duplicate spellings and no small sub-genres.</p>}
        {consolidation.variantGroups.length > 0 && (
          <>
            <h4 className="genre-heading">Same genre, different spelling</h4>
            <ul>
              {consolidation.variantGroups.map((group) => (
                <li key={group.names.join('|')}>{group.names.join(' / ')} — {group.artistsAffected} artist{group.artistsAffected === 1 ? '' : 's'}</li>
              ))}
            </ul>
          </>
        )}
        {consolidation.smallSubgenres.length > 0 && (
          <>
            <h4 className="genre-heading">Small sub-genres that could fold into their broad genre</h4>
            <ul>
              {consolidation.smallSubgenres.map((group) => (
                <li key={group.parent}>
                  <strong>{group.parent === 'other' ? 'Other' : group.parent}</strong>: {group.subgenreCount} sub-genre{group.subgenreCount === 1 ? '' : 's'}
                  {' '}used by ≤{consolidation.smallThreshold}, touching {group.artistsAffected} artist{group.artistsAffected === 1 ? '' : 's'}
                  {' '}({group.subgenres.slice(0, 8).join(', ')}{group.subgenreCount > 8 ? ', …' : ''})
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

export default function GenresPage() {
  const [threshold, setThreshold] = useState(1);
  const stats = useQuery({ queryKey: ['genreStats', threshold], queryFn: () => api.genres.stats(threshold) });
  return (
    <div>
      <div className="page-header"><h2>Genres</h2></div>
      {stats.isLoading && <p className="empty-state" role="status">Loading genres…</p>}
      {stats.error && <p className="empty-state" role="alert">{(stats.error as Error).message}</p>}
      {stats.data && <GenreStatsView stats={stats.data} threshold={threshold} onThreshold={setThreshold} />}
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ArtistGenreView, GenreStats } from '@vidarr/shared-types';
import GenreEditor, { formatGenreUsage } from '../src/components/GenreEditor';
import { GenreStatsView } from '../src/pages/GenresPage';

const view: ArtistGenreView = {
  artistId: 7,
  genreString: 'rock, shoegaze',
  userOverride: false,
  refreshedAt: null,
  totalArtists: 80,
  effective: [
    { name: 'rock', level: 'genre', parent: null, sources: ['musicbrainz', 'lastfm'], score: 1.25, artistCount: 24, percentOfArtists: 30 },
    { name: 'shoegaze', level: 'subgenre', parent: 'rock', sources: ['musicbrainz'], score: 0.9, artistCount: 2, percentOfArtists: 2.5 },
  ],
  sources: {
    user: [], connector: [], embedded: [],
    musicbrainz: [{ name: 'shoegaze', level: 'subgenre', parent: 'rock', votes: 9, inEffect: true }],
    lastfm: [{ name: 'dream pop', level: 'subgenre', parent: 'pop', votes: 70, inEffect: false }],
  },
  alternatives: [{ name: 'dream pop', level: 'subgenre', parent: 'pop', reason: 'Last.fm (70/100)', artistCount: 5, percentOfArtists: 6.3 }],
};

function renderEditor(data: ArtistGenreView) {
  const client = new QueryClient();
  client.setQueryData(['artistGenres', data.artistId], data);
  return renderToStaticMarkup(<QueryClientProvider client={client}><GenreEditor artistId={data.artistId} /></QueryClientProvider>);
}

describe('formatGenreUsage', () => {
  it('states the count, the library size and the percentage', () => {
    expect(formatGenreUsage(24, 30, 80)).toBe('24 of 80 artists (30%)');
    expect(formatGenreUsage(1, 100, 1)).toBe('1 of 1 artist (100%)');
    expect(formatGenreUsage(0, 0, 0)).toBe('No library artists yet');
  });
});

describe('GenreEditor', () => {
  it('separates genres from sub-genres and shows how common each is in the library', () => {
    const html = renderEditor(view);
    expect(html).toContain('24 of 80 artists (30%)');
    expect(html).toContain('2 of 80 artists (2.5%)');
    expect(html).toMatch(/Genres<\/h4>[\s\S]*rock[\s\S]*Sub-genres<\/h4>[\s\S]*shoegaze/);
    expect(html).toContain('MusicBrainz + Last.fm');
  });

  it('offers alternatives with their library usage and the reason they were suggested', () => {
    const html = renderEditor(view);
    expect(html).toContain('aria-label="Add dream pop"');
    expect(html).toContain('5 of 80 artists (6.3%)');
    expect(html).toContain('Last.fm (70/100)');
  });

  it('only offers "Reset to automatic" once the user has set their own genres', () => {
    expect(renderEditor(view)).not.toContain('Reset to automatic');
    const edited = renderEditor({ ...view, userOverride: true });
    expect(edited).toContain('Reset to automatic');
    expect(edited).toContain('Your edits are in force');
  });

  it('lists what each source reported, marking those in force', () => {
    const html = renderEditor(view);
    expect(html).toContain('shoegaze (9) ✓');
    expect(html).toContain('dream pop (70)');
  });
});

const stats: GenreStats = {
  totalArtists: 80,
  artistsWithGenre: 60,
  genres: [{
    name: 'rock', isOther: false, artistCount: 24, percentOfArtists: 30, percentOfGenred: 40, directArtistCount: 10,
    subgenres: [
      { name: 'shoegaze', parent: 'rock', artistCount: 2, percentOfArtists: 2.5, percentOfParent: 8.3 },
      { name: 'grunge', parent: 'rock', artistCount: 1, percentOfArtists: 1.3, percentOfParent: 4.2 },
    ],
  }],
  consolidation: {
    smallThreshold: 1,
    variantGroups: [{ names: ['synth-pop', 'synthpop'], artistsAffected: 3 }],
    smallSubgenres: [{ parent: 'rock', subgenres: ['grunge'], subgenreCount: 1, artistsAffected: 1 }],
  },
};

describe('GenreStatsView', () => {
  const render = (s: GenreStats) => renderToStaticMarkup(<MemoryRouter><GenreStatsView stats={s} threshold={1} onThreshold={() => {}} /></MemoryRouter>);

  it('shows counts and both percentages for genres and sub-genres', () => {
    const html = render(stats);
    expect(html).toContain('60 of 80 Library artists have a genre');
    expect(html).toContain('24</strong> artists');
    expect(html).toContain('30% of library');
    expect(html).toContain('40% of genred artists');
    expect(html).toContain('<td>2</td><td>2.5%</td><td>8.3%</td>');
  });

  it('surfaces consolidation hints without offering to change anything', () => {
    const html = render(stats);
    expect(html).toContain('synth-pop / synthpop');
    expect(html).toContain('used by ≤1, touching 1 artist');
    expect(html).toContain('nothing here changes your data');
  });

  it('says so when nothing needs consolidating', () => {
    const html = render({ ...stats, consolidation: { smallThreshold: 1, variantGroups: [], smallSubgenres: [] } });
    expect(html).toContain('Nothing stands out');
  });

  it('explains an empty library instead of rendering an empty table', () => {
    const html = render({ ...stats, totalArtists: 0, artistsWithGenre: 0, genres: [] });
    expect(html).toContain('No genres yet');
  });
});

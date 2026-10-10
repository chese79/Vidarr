import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DiscoverPage from '../src/pages/DiscoverPage';
import PlaylistsPage from '../src/pages/PlaylistsPage';
import AddArtistForm from '../src/components/AddArtistForm';

function render(page: React.ReactNode, url: string, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{page}</MemoryRouter></QueryClientProvider>);
}

describe('Discover and playlist controls', () => {
  it('uses MusicBrainz for Library additions and removes manual addition', () => {
    const html = render(<AddArtistForm onDone={() => {}} />, '/library');
    expect(html).toContain('Search MusicBrainz');
    expect(html).not.toContain('Search IMVDb');
    expect(html).not.toContain('Add manually');
  });
  it('shows genre confirmation for the selected library artist with current genres checked', () => {
    const client = new QueryClient();
    client.setQueryData(['artists'], [{ id: 12, name: 'Example Artist' }]);
    client.setQueryData(['artistGenres', 12], { effective: [{ name: 'rock' }], alternatives: [{ name: 'pop' }], sources: { musicbrainz: [{ name: 'rock' }] } });
    const html = render(<DiscoverPage />, '/discover?libraryArtist=12', client);
    expect(html).toContain('Confirm Genre &amp; Add All');
    expect(html).toMatch(/type="checkbox" checked=""\/> rock/);
    expect(html).toMatch(/type="checkbox"\/> pop/);
    expect(html).toContain('Owned videos and active downloads are skipped');
  });

  it('restores Discover filters and checked recommendations from its return URL', () => {
    const client = new QueryClient();
    client.setQueryData(['recommendations'], [{ id: 7, artistName: 'Example Artist', genre: 'Rock', mbid: 'id', aggregateScore: 1, playCount: 0, sourceHits: [{ source: 'library' }] }]);
    const html = render(<DiscoverPage />, '/discover?search=Example&genre=Rock&selected=7&artistSearch=Example&addNew=1&newArtistName=Another', client);
    expect(html).toContain('value="Example"');
    expect(html).toMatch(/aria-label="Select Example Artist"[^>]*checked/);
    expect(html).toContain('Add New Artist');
    expect(html).toContain('value="Another"');
    expect(html).toContain('class="add-new-artist"');
    expect(html).toContain('Validates the artist against MusicBrainz');
    expect(html).not.toContain('Add unverified artist anyway');
  });

  it('starts the creator at 20 shuffled videos, with unwatched opt-in and autocomplete instead of Quality', () => {
    const html = render(<PlaylistsPage />, '/playlists');
    expect(html).toMatch(/aria-label="Videos to add"[^>]*value="20"/);
    expect(html).toContain('<option value="shuffle" selected="">');
    expect(html).toContain('Only add unwatched videos');
    expect(html).toContain('list="generate-genres"');
    expect(html).toContain('list="generate-directors"');
    expect(html).not.toContain('aria-label="Quality"');
    expect(html.lastIndexOf('aria-label="Director"')).toBeGreaterThan(html.lastIndexOf('aria-label="Filter by specific video"'));
  });
});

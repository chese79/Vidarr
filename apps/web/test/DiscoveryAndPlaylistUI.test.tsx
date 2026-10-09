import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DiscoverPage from '../src/pages/DiscoverPage';
import PlaylistsPage from '../src/pages/PlaylistsPage';

function render(page: React.ReactNode, url: string, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{page}</MemoryRouter></QueryClientProvider>);
}

describe('Discover and playlist controls', () => {
  it('restores Discover filters and checked recommendations from its return URL', () => {
    const client = new QueryClient();
    client.setQueryData(['recommendations'], [{ id: 7, artistName: 'Example Artist', genre: 'Rock', mbid: 'id', aggregateScore: 1, playCount: 0, sourceHits: [{ source: 'library' }] }]);
    const html = render(<DiscoverPage />, '/discover?search=Example&genre=Rock&selected=7&artistSearch=Example&addNew=1&newArtistName=Another', client);
    expect(html).toContain('value="Example"');
    expect(html).toMatch(/aria-label="Select Example Artist"[^>]*checked/);
    expect(html).toContain('Add New Artist');
    expect(html).toContain('value="Another"');
    expect(html).toContain('class="add-new-artist"');
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

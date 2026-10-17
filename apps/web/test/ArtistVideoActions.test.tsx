import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ArtistDetailPage from '../src/pages/ArtistDetailPage';
import SettingsPage from '../src/pages/SettingsPage';
import App from '../src/App';
import { filterArtistVideos } from '../src/pages/artistVideoFilters';

function render(element: React.ReactNode, client = new QueryClient(), url = '/') {
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{element}</MemoryRouter></QueryClientProvider>);
}
it('filters names without matching unrelated metadata and ignores case and surrounding whitespace', () => {
  const videos = [{ title: 'The Way I Am', genre: 'pop' }, { title: 'Girls Chase Boys', genre: 'way' }];
  expect(filterArtistVideos(videos, ' WAY ')).toEqual([videos[0]]);
  expect(filterArtistVideos(videos, '  ')).toEqual(videos);
  expect(filterArtistVideos(videos, 'absent')).toEqual([]);
});
it('shows collapsed genres, video search and per-video actions', () => {
  const client = new QueryClient();
  client.setQueryData(['artist', 7], { id: 7, name: 'Artist', monitored: false, musicbrainzCandidates: [], youtubeSources: [], unmatchedInventory: [], summary: { known: 1, available: 0, missing: 1, monitored: 0 },
    musicVideos: [{ id: 9, title: 'Song', releaseYear: 2026, monitored: false, ignored: false, hasFile: false, qualifiedPlayCount: 3, status: { ownership: 'none', acquisition: null }, libraryVideos: [], acquisitionSources: [] }] });
  const html = render(<Routes><Route path="/artist/:id" element={<ArtistDetailPage />} /></Routes>, client, '/artist/7');
  expect(html).toContain('<details class="artist-genres"><summary>Genres</summary>');
  expect(html).toContain('<h3>Videos</h3>');
  expect(html).toContain('Filter videos by name');
  expect(html).toContain('Flag as Live/Concert');
  expect(html).toContain('3 qualified plays');
  expect(html).toContain('aria-label="Delete Song"');
});
it('places both deletion preferences together and explains rediscovery', () => {
  const html = render(<SettingsPage />);
  expect(html).toContain('Warn before delete');
  expect(html).toContain('Exclude deleted videos from future scans');
  expect(html).toContain('Turning it off permits rediscovery');
  expect(html).toContain('half the video or four minutes of observed watching');
});
it('places queue and history immediately below genres', () => {
  const html = render(<App />);
  expect(html).toMatch(/>Genres<\/a><\/li><li><a[^>]*href="\/queue"[^>]*>Queue<\/a><\/li><li><a[^>]*href="\/history"/);
});

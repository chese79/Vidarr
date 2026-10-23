import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import LibraryPage from '../src/pages/LibraryPage';
import App from '../src/App';
import { isNewArtist } from '../src/components/ArtistProgress';

function render(url: string, hide: boolean) {
  const client = new QueryClient();
  client.setQueryData(['artistSummary', '', '', null, null, null, false, '', '', '', 1, hide], {
    items: [{ id: 1, name: 'New Artist', addedAt: new Date().toISOString(), monitored: false, hasImage: false,
      musicbrainzMatchStatus: 'confirmed', videoInventoryStatus: 'running', pendingVideoReviewCount: 2,
      knownVideoCount: 0, availableVideoCount: 0, monitoredVideoCount: 0, missingVideoCount: 0, qualifiedPlayCount: 2, aggregatePlayCount: 7 }],
    total: 1, availableLetters: ['N'],
  });
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><App /></MemoryRouter></QueryClientProvider>);
}

it('keeps empty-artist hiding on the global bar and exposes only server plays and review progress', () => {
  const html = render('/', true);
  expect(html).toContain('class="hide-empty-artists enabled"');
  expect(html).toContain('Hide Artists w/o Videos');
  expect(html).toContain('status-chip new-artist'); expect(html).toContain('Collecting video sources');
  expect(html).not.toContain('qualified plays'); expect(html).toContain('7 server plays');
  expect(html).toContain('2 videos need review'); expect(html).toContain('/video-review?artistId=1');
  const off = render('/?hideWithoutVideos=false', false);
  expect(off).toContain('class="hide-empty-artists"'); expect(off).not.toContain('class="hide-empty-artists enabled"');
});

it('limits New to the first seven days and rejects missing, invalid or future timestamps', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  expect(isNewArtist('2026-10-09T12:00:00Z', now)).toBe(true);
  for (const value of [undefined, 'invalid', '2026-10-03T12:00:00Z', '2026-10-11T12:00:00Z']) expect(isNewArtist(value, now)).toBe(false);
});

import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import LibraryPage from '../src/pages/LibraryPage';
import { isNewArtist } from '../src/components/ArtistProgress';

function render(url: string, hide: boolean) {
  const client = new QueryClient();
  client.setQueryData(['artistSummary', '', '', null, null, null, false, '', '', '', 1, hide], {
    items: [{ id: 1, name: 'New Artist', addedAt: new Date().toISOString(), monitored: false, hasImage: false,
      musicbrainzMatchStatus: 'confirmed', videoInventoryStatus: 'running', pendingVideoReviewCount: 2,
      knownVideoCount: 0, availableVideoCount: 0, monitoredVideoCount: 0, missingVideoCount: 0 }],
    total: 1, availableLetters: ['N'],
  });
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><LibraryPage /></MemoryRouter></QueryClientProvider>);
}

it('defaults empty-artist hiding on next to the count, highlights it and exposes source/review progress', () => {
  const html = render('/library', true);
  expect(html).toMatch(/class="hide-empty-artists enabled"[^>]*><input type="checkbox" checked=""\/>Hide Artists w\/o Videos/);
  expect(html.indexOf('1 artist(s)')).toBeLessThan(html.indexOf('Hide Artists w/o Videos'));
  expect(html).toContain('status-chip new-artist'); expect(html).toContain('Collecting video sources');
  expect(html).toContain('2 videos need review'); expect(html).toContain('/video-review?artistId=1');
  const off = render('/library?hideWithoutVideos=false', false);
  expect(off).toContain('class="hide-empty-artists"'); expect(off).not.toContain('class="hide-empty-artists enabled"');
});

it('limits New to the first seven days and rejects missing, invalid or future timestamps', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  expect(isNewArtist('2026-10-09T12:00:00Z', now)).toBe(true);
  for (const value of [undefined, 'invalid', '2026-10-03T12:00:00Z', '2026-10-11T12:00:00Z']) expect(isNewArtist(value, now)).toBe(false);
});

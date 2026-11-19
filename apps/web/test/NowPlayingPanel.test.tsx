import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NowPlayingPanel from '../src/components/NowPlayingPanel';
import type { NowPlaying } from '@vidarr/shared-types';
const item = { id: 1, connectorName: 'JF', title: 'Song', artistName: 'Artist', userName: 'Owner', deviceName: 'Roku',
  playing: true, lastSeenAt: '2026-11-18T12:00:00Z', musicVideoId: 9, artistId: 7, catalogKind: 'official', recordingId: null };
function render(data: NowPlaying) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['nowPlaying'], data);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><NowPlayingPanel /></MemoryRouter></QueryClientProvider>);
  client.clear(); return html;
}
it('links the exact playing video to its artist controls and identifies the player/user', () => {
  const html = render({ enabled: true, stale: false, items: [item] });
  expect(html).toContain('href="/artist/7#video-9"'); expect(html).toContain('Artist — Song'); expect(html).toContain('Roku · Owner · JF');
});
it('shows paused playback and directs uncertain matches to review', () => {
  const html = render({ enabled: true, stale: false, items: [{ ...item, playing: false, musicVideoId: null, artistId: null }] });
  expect(html).toContain('Paused'); expect(html).toContain('Review library match'); expect(html).not.toContain('#video-');
});
it('opens reviewed Live recordings and retains a legacy classified artist route', () => {
  const html = render({ enabled: true, stale: false, items: [{ ...item, recordingId: 5 }, { ...item, id: 2, catalogKind: 'liveClassified' }] });
  expect(html).toContain('href="/live/recording/5"'); expect(html).toContain('href="/artist/7/live"');
});
it('labels stale observations explicitly and keeps the management link available', () => {
  const html = render({ enabled: true, stale: true, items: [item] });
  expect(html).toContain('Last seen playing'); expect(html).toContain('Last observed'); expect(html).toContain('/artist/7#video-9');
});
it('identifies disabled monitoring without claiming that nothing is playing', () => {
  const html = render({ enabled: false, stale: false, items: [] });
  expect(html).toContain('monitoring is disabled'); expect(html).toContain('href="/system"');
});

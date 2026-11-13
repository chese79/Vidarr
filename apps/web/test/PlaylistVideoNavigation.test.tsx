// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { PlaylistItemSchema } from '@vidarr/shared-types';
import PlaylistsPage from '../src/pages/PlaylistsPage';
import App from '../src/App';
import { CatalogModeContext } from '../src/components/CatalogMode';

it('opens the exact playlist video after artist data arrives and leaves its management controls available', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const item = PlaylistItemSchema.parse({ id: 1, musicVideoId: 9, sortOrder: 0,
    musicVideo: { title: 'Song', thumbnailUrl: null, hasFile: true, artist: { id: 7, name: 'Artist' } } });
  client.setQueryData(['playlists'], [{ id: 1, name: 'Saved', kind: 'smart', sortMode: 'shuffle', targetConnectorId: null, items: [item], syncs: [] }]);
  for (const key of ['libraryConnectors', 'artists', 'qualityProfiles', 'rootFolders']) client.setQueryData([key], []);
  client.setQueryData(['settings'], { warnBeforeDelete: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  const originalScrollTo = HTMLElement.prototype.scrollTo;
  const pageScroll = vi.fn();
  HTMLElement.prototype.scrollTo = pageScroll;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists']}><App /></MemoryRouter></QueryClientProvider>));
    const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Manage Song in artist library"]')!;
    expect(link.getAttribute('href')).toBe('/artist/7#video-9');
    await act(async () => link.click());
    const artist = { id: 7, name: 'Artist', monitored: false, unmatchedInventory: [], summary: {}, musicVideos: [8, 9].map(id => ({
      id, title: 'Song', hasFile: true, monitored: false, libraryVideos: [], acquisitionSources: [], status: { ownership: 'local', acquisition: null },
    })) };
    await act(async () => { client.setQueryData(['artist', 7], artist); });
    const target = host.querySelector('#video-9')!;
    expect(document.activeElement).toBe(target);
    expect(target.textContent).toContain('Flag as Live/Concert');
    expect(target.querySelector('button[aria-label="Delete Song"]')).not.toBeNull();
    expect(scroll).toHaveBeenCalledOnce();
    expect(pageScroll).toHaveBeenCalledOnce(); // Only the initial playlist page resets to the top.
    await act(async () => { client.setQueryData(['artist', 7], { ...artist, name: 'Updated' }); });
    expect(scroll).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); client.clear(); host.remove();
    HTMLElement.prototype.scrollIntoView = original;
    HTMLElement.prototype.scrollTo = originalScrollTo;
  }
});

it('links Live entries to recordings and omits artist links for legacy entries without an artist ID', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['playlists'], [{ id: 1, name: 'Mixed', kind: 'static', sortMode: 'shuffle', targetConnectorId: null, syncs: [], items: [
    { id: 1, musicVideoId: 9, musicVideo: { title: 'Legacy', artist: { name: 'Artist' } } },
    { id: 2, musicVideoId: null, recordingPartId: 4, recordingPart: { id: 4, recording: { id: 3, title: 'Concert' } } },
  ] }]);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><CatalogModeContext.Provider value={{ mode: 'both', setMode: () => {} }}><PlaylistsPage /></CatalogModeContext.Provider></MemoryRouter></QueryClientProvider>));
    expect(host.querySelector('a[aria-label="Manage Concert recording"]')?.getAttribute('href')).toBe('/live/recording/3');
    expect(host.querySelector('a[aria-label="Manage Legacy in artist library"]')).toBeNull();
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});

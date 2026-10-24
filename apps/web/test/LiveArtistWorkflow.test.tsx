// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import LivePage from '../src/pages/LivePage';
import { LiveDiscoveryControls } from '../src/components/LiveControls';
import { api } from '../src/api/client';
import { CATALOG_MODE_KEY } from '../src/catalogMode';

vi.mock('../src/contentScroll', () => ({ scrollContentTo: vi.fn(), contentScrollTop: () => 0 }));
let client: QueryClient, host: HTMLDivElement, root: Root;
const page = { items: [], total: 0, offset: 0, limit: 25 };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); localStorage.setItem(CATALOG_MODE_KEY, 'live');
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api.queue, 'list').mockResolvedValue([]);
  vi.spyOn(api.rootFolders, 'list').mockResolvedValue([]);
  vi.spyOn(api.qualityProfiles, 'list').mockResolvedValue([]);
  vi.spyOn(api.artists, 'list').mockResolvedValue([]);
  vi.spyOn(api.artists, 'summary').mockResolvedValue({ items: [{ id: 42, name: 'Adele', hasImage: false, musicbrainzMatchStatus: 'confirmed', knownVideoCount: 0, availableVideoCount: 0 }], total: 1, availableLetters: ['A'] } as never);
  vi.spyOn(api.live, 'artists').mockResolvedValue({ ...page, items: [{ id: 42, name: 'Adele' }] });
  vi.spyOn(api.live, 'performances').mockResolvedValue(page);
  vi.spyOn(api.live, 'recordings').mockResolvedValue(page);
  vi.spyOn(api.live, 'configuration').mockResolvedValue({ hasSetlistApiKey: false, setlistPaused: false } as never);
  vi.spyOn(api.live, 'action');
  vi.spyOn(api.settings, 'get').mockResolvedValue({ liveEnabled: true, liveAvailable: true } as never);
  vi.spyOn(api.live, 'read').mockResolvedValue({ enabled: false, items: [], total: 0 } as never);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount(content: React.ReactNode, url = '/live?letter=A&q=Adele&missing=true&minPlayCount=10') {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{content}</MemoryRouter></QueryClientProvider>));
  await flush();
}
async function click(selector: string) { await act(async () => (host.querySelector(selector) as HTMLButtonElement).click()); await flush(); }

it('retains the artist index and list in Live mode without music-video exclusions or global searches', async () => {
  await mount(<App />);
  expect(host.querySelector('[aria-label="Jump to a letter"]')).not.toBeNull();
  expect(host.querySelector('.artist-list')?.textContent).toContain('Adele');
  expect((host.querySelector('[aria-label="Search artists"]') as HTMLInputElement).value).toBe('Adele');
  expect(api.artists.summary).toHaveBeenCalledWith(expect.objectContaining({ hideWithoutVideos: false, hasMissing: undefined, minPlayCount: undefined, letter: 'A' }));
  expect(host.textContent).not.toContain('Search all eligible');
  expect(host.textContent).not.toContain('Search missing');
  expect(api.live.performances).not.toHaveBeenCalled();
  await click('[aria-label="Expand Adele\'s Live catalog"]');
  expect(api.live.performances).toHaveBeenCalledWith(expect.stringContaining('artistId=42'));
  expect(host.textContent).toContain('Event history requires a setlist.fm API key');
  const historyButton = [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith('Explore setlist.fm performances'))!;
  expect(historyButton.disabled).toBe(true);
  expect(api.live.action).not.toHaveBeenCalled();
  const recordingsButton = [...host.querySelectorAll('button')].find(button => button.textContent === 'Recordings')!;
  await act(async () => recordingsButton.click()); await flush();
  expect(api.live.recordings).toHaveBeenCalledWith(expect.stringContaining('artistId=42'));
});

it('uses distinct Live and Both themes and restores the Music Videos theme when switching', async () => {
  await mount(<App />);
  expect(host.querySelector('.app-shell')?.classList.contains('catalog-live')).toBe(true);
  await click('[aria-label="Global media filter"] button:nth-child(3)');
  expect(host.querySelector('.app-shell')?.classList.contains('catalog-both')).toBe(true);
  expect(host.querySelector('.app-shell')?.classList.contains('catalog-live')).toBe(false);
  await click('[aria-label="Global media filter"] button:nth-child(1)');
  expect(host.querySelector('.app-shell')?.className).toBe('app-shell');
});

it('preserves artist filters and the index when switching between Live and music-video modes', async () => {
  await mount(<App />);
  await click('[aria-label="Global media filter"] button:nth-child(1)');
  expect(host.querySelector('.artist-list')?.textContent).toContain('Adele');
  await click('[aria-label="Global media filter"] button:nth-child(2)');
  expect(host.querySelector('[aria-label="Jump to a letter"]')).not.toBeNull();
  expect((host.querySelector('[aria-label="Search artists"]') as HTMLInputElement).value).toBe('Adele');
  expect(api.live.performances).not.toHaveBeenCalled();
});

it('does not issue global catalog requests when a Live page has no valid artist context', async () => {
  await mount(<LivePage />, '/live?search=concert');
  expect(host.textContent).toContain('Choose an artist');
  expect(api.live.performances).not.toHaveBeenCalled();
  expect(api.live.recordings).not.toHaveBeenCalled();
  expect(host.querySelector('input')).toBeNull();
});

it('explains missing or paused history credentials while permitting a configured provider', () => {
  for (const state of [{ hasSetlistApiKey: false, setlistPaused: false }, { hasSetlistApiKey: true, setlistPaused: true }, { hasSetlistApiKey: true, setlistPaused: false }]) {
    client.setQueryData(['live-configuration'], state);
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><LiveDiscoveryControls artistId={42} /></MemoryRouter></QueryClientProvider>);
    expect(/disabled=""[^>]*>Explore setlist.fm performances/.test(html)).toBe(!state.hasSetlistApiKey || state.setlistPaused);
    if (!state.hasSetlistApiKey || state.setlistPaused) expect(html).toContain('Open Library settings');
  }
});

import { afterEach, expect, it, vi } from 'vitest';
import type { LibraryConnector } from '@prisma/client';
import { plexProvider } from '../src/providers/library/plex.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';

const config = { id: 1, host: 'http://server.test', authToken: 'fixture', userId: 'user', videoLibraryId: 'library' } as LibraryConnector;
const item = { externalId: 'video', expectedPath: '/media/song.mp4' };
afterEach(() => vi.unstubAllGlobals());

for (const [name, provider] of [['Plex', plexProvider], ['Jellyfin', jellyfinProvider]] as const) {
  it(`${name} detects a paused session without requiring motion or duration telemetry`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(name === 'Plex'
      ? { MediaContainer: { Metadata: [{ ratingKey: 'video', Player: { state: 'paused' } }] } }
      : [{ NowPlayingItem: { Id: 'video' }, PlayState: { IsPaused: true } }])));
    expect(await provider.isVideoInUse!(config, 'video')).toBe(true);
    expect(await provider.isVideoInUse!(config, 'another')).toBe(false);
  });
  function metadata(file = item.expectedPath) {
    return name === 'Plex' ? { MediaContainer: { Metadata: [{ ratingKey: 'video', librarySectionID: 'library', type: 'clip', Media: [{ Part: [{ file }] }] }] } }
      : { Id: 'video', Type: 'MusicVideo', Path: file };
  }
  it(`${name} deletes only a freshly verified item and confirms its absence`, async () => {
    let removed = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { removed = true; return new Response(null, { status: 204 }); }
      if (url.includes('ParentId=')) return Response.json({ Items: [{ Id: 'video' }], TotalRecordCount: 1 });
      return removed ? new Response(null, { status: 404 }) : Response.json(metadata());
    });
    vi.stubGlobal('fetch', fetcher);
    await provider.verifyVideoDeletion!(config, item);
    await provider.deleteVideo!(config, item);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
  it(`${name} refuses changed media paths before sending DELETE`, async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.includes('ParentId=') ? { Items: [{ Id: 'video' }], TotalRecordCount: 1 } : metadata('/other/version.mp4')));
    vi.stubGlobal('fetch', fetcher);
    await expect(provider.deleteVideo!(config, item)).rejects.toThrow('paths changed');
    expect(fetcher.mock.calls.every(call => call.length === 1 || (call[1] as RequestInit)?.method !== 'DELETE')).toBe(true);
  });
  it(`${name} treats 404 as already deleted but propagates authentication failures`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await provider.deleteVideo!(config, item);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    await expect(provider.deleteVideo!(config, item)).rejects.toThrow('401');
  });
  it(`${name} refuses to declare success while the item remains in the server catalog`, async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => init?.method === 'DELETE' ? new Response(null, { status: 204 })
      : Response.json(url.includes('ParentId=') ? { Items: [{ Id: 'video' }], TotalRecordCount: 1 } : metadata())));
    await expect(provider.deleteVideo!(config, item)).rejects.toThrow('still reports');
  });
}

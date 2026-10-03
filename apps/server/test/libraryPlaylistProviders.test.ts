import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryConnector } from '@prisma/client';
import { plexProvider } from '../src/providers/library/plex.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 404 ? 'Not Found' : status >= 500 ? 'Server Error' : 'OK',
  json: async () => body,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

// Routes each request by "METHOD path" to a canned response, recording calls.
function stubFetch(routes: (method: string, path: string) => ReturnType<typeof reply> | undefined) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push(`${method} ${path}`);
    const response = routes(method, path);
    if (!response) throw new Error(`Unexpected request: ${method} ${path}`);
    return response;
  }));
  return calls;
}

describe('Plex playlist push by reconciled id', () => {
  const connector = { type: 'plex', host: 'http://plex:32400', authToken: 'token', videoLibraryId: '7' } as LibraryConnector;
  const push = (items: { artistName: string; title: string; externalId?: string }[], existingRemoteId: string | null = null) =>
    plexProvider.pushPlaylist!(connector, { name: 'List', items, existingRemoteId });

  const identityAndCreate = (method: string, path: string) => {
    if (path === '/identity') return reply(200, { MediaContainer: { machineIdentifier: 'machine' } });
    if (method === 'POST' && path.startsWith('/playlists?')) return reply(200, { MediaContainer: { Metadata: [{ ratingKey: 900 }] } });
    return undefined;
  };

  it('distinguishes two same-titled videos by their reconciled ids, where a title search gives up', async () => {
    const calls = stubFetch((method, path) => {
      if (path === '/library/metadata/11') return reply(200, { MediaContainer: { Metadata: [{ ratingKey: 11, librarySectionID: 7 }] } });
      if (path === '/library/metadata/22') return reply(200, { MediaContainer: { Metadata: [{ ratingKey: 22, librarySectionID: 7 }] } });
      return identityAndCreate(method, path);
    });

    const result = await push([
      { artistName: 'Artist One', title: 'Intro', externalId: '11' },
      { artistName: 'Artist Two', title: 'Intro', externalId: '22' },
    ]);

    expect(result).toMatchObject({ remotePlaylistId: '900', matchedCount: 2, unmatchedTitles: [] });
    const create = calls.find((call) => call.startsWith('POST /playlists?'))!;
    expect(decodeURIComponent(create)).toContain('/library/metadata/11,22');
    // No per-item title search against the library section was needed.
    expect(calls.some((call) => call.startsWith('GET /library/sections/'))).toBe(false);
  });

  it('falls back to the title search only when the reconciled id no longer exists', async () => {
    const calls = stubFetch((method, path) => {
      if (path === '/library/metadata/11') return reply(404);
      if (path.startsWith('/library/sections/7/all?type=1&title=')) {
        return reply(200, { MediaContainer: { Metadata: [{ ratingKey: 55, title: 'Gone Song' }] } });
      }
      return identityAndCreate(method, path);
    });

    const result = await push([{ artistName: 'A', title: 'Gone Song', externalId: '11' }]);

    expect(result.matchedCount).toBe(1);
    expect(decodeURIComponent(calls.find((call) => call.startsWith('POST /playlists?'))!)).toContain('/library/metadata/55');
  });

  it('does not use an id that now lives in a different library section', async () => {
    stubFetch((method, path) => {
      if (path === '/library/metadata/11') return reply(200, { MediaContainer: { Metadata: [{ ratingKey: 11, librarySectionID: 3 }] } });
      if (path.startsWith('/library/sections/7/all')) return reply(200, { MediaContainer: { Metadata: [] } });
      return identityAndCreate(method, path);
    });

    await expect(push([{ artistName: 'A', title: 'Moved', externalId: '11' }]))
      .rejects.toThrow('None of this playlist');
  });

  it('fails the push on a non-404 error instead of silently falling back to a title guess', async () => {
    const calls = stubFetch((_method, path) => (path === '/library/metadata/11' ? reply(500) : undefined));

    await expect(push([{ artistName: 'A', title: 'T', externalId: '11' }])).rejects.toThrow('500');
    expect(calls).toEqual(['GET /library/metadata/11']);
  });

  it('refuses to create an empty playlist', async () => {
    const calls = stubFetch(() => undefined);
    await expect(push([])).rejects.toThrow('None of this playlist');
    expect(calls).toEqual([]);
  });

  it('removes a playlist by id and treats one that is already gone as removed', async () => {
    const calls = stubFetch((method, path) => (method === 'DELETE' && path === '/playlists/900' ? reply(404) : undefined));
    await expect(plexProvider.deletePlaylist!(connector, '900')).resolves.toBeUndefined();
    expect(calls).toEqual(['DELETE /playlists/900']);
  });

  it('surfaces a real failure when removing a playlist', async () => {
    stubFetch(() => reply(500));
    await expect(plexProvider.deletePlaylist!(connector, '900')).rejects.toThrow('500');
  });
});

describe('Jellyfin playlist push by reconciled id', () => {
  const connector = {
    type: 'jellyfin', host: 'http://jelly:8096', authToken: 'token', userId: 'u1', videoLibraryId: 'lib',
  } as LibraryConnector;
  const push = (items: { artistName: string; title: string; externalId?: string }[]) =>
    jellyfinProvider.pushPlaylist!(connector, { name: 'List', items, existingRemoteId: null });

  it('uses the verified reconciled id and never searches', async () => {
    const calls = stubFetch((method, path) => {
      if (path === '/Users/u1/Items/abc') return reply(200, { Id: 'abc' });
      if (method === 'POST' && path === '/Playlists') return reply(200, { Id: 'pl' });
      return undefined;
    });

    const result = await push([{ artistName: 'A', title: 'T', externalId: 'abc' }]);

    expect(result).toMatchObject({ remotePlaylistId: 'pl', matchedCount: 1, unmatchedTitles: [] });
    expect(calls.some((call) => call.includes('SearchTerm='))).toBe(false);
  });

  it('falls back to the title and artist search when the id returns 404', async () => {
    const calls = stubFetch((method, path) => {
      if (path === '/Users/u1/Items/abc') return reply(404);
      if (path.includes('SearchTerm=Re-keyed')) return reply(200, { Items: [{ Id: 'new-id', Name: 'Re-keyed', Artists: ['A'] }] });
      if (method === 'POST' && path === '/Playlists') return reply(200, { Id: 'pl' });
      return undefined;
    });

    const result = await push([{ artistName: 'A', title: 'Re-keyed', externalId: 'abc' }]);

    expect(result.matchedCount).toBe(1);
    expect(calls).toContain('POST /Playlists');
  });

  it('fails the push on a non-404 error instead of silently falling back', async () => {
    const calls = stubFetch((_method, path) => (path === '/Users/u1/Items/abc' ? reply(503) : undefined));
    await expect(push([{ artistName: 'A', title: 'T', externalId: 'abc' }])).rejects.toThrow('503');
    expect(calls).toEqual(['GET /Users/u1/Items/abc']);
  });

  it('refuses to create an empty playlist', async () => {
    const calls = stubFetch(() => undefined);
    await expect(push([])).rejects.toThrow('None of this playlist');
    expect(calls).toEqual([]);
  });

  it('removes a playlist by id and treats one that is already gone as removed', async () => {
    const calls = stubFetch((method, path) => (method === 'DELETE' && path === '/Items/pl-1' ? reply(404) : undefined));
    await expect(jellyfinProvider.deletePlaylist!(connector, 'pl-1')).resolves.toBeUndefined();
    expect(calls).toEqual(['DELETE /Items/pl-1']);
  });

  it('surfaces a real failure when removing a playlist', async () => {
    stubFetch(() => reply(500));
    await expect(jellyfinProvider.deletePlaylist!(connector, 'pl-1')).rejects.toThrow('500');
  });
});

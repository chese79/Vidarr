import { describe, it, expect, vi, afterEach } from 'vitest';
import { baseUrl, createAuthedFetcher } from '../src/providers/library/util.js';
import type { LibraryConnector } from '@prisma/client';

function fakeConnector(overrides: Partial<LibraryConnector> = {}): LibraryConnector {
  return {
    id: 1,
    name: 'Test',
    type: 'jellyfin',
    host: 'http://jellyfin.local:8096',
    authToken: 'secret-token',
    username: null,
    password: null,
    userId: null,
    musicLibraryId: null,
    videoLibraryId: null,
    enabled: true,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    ...overrides,
  };
}

describe('baseUrl', () => {
  it('strips a single trailing slash', () => {
    expect(baseUrl('http://host:8096/')).toBe('http://host:8096');
  });

  it('strips multiple trailing slashes', () => {
    expect(baseUrl('http://host:8096///')).toBe('http://host:8096');
  });

  it('leaves a host with no trailing slash unchanged', () => {
    expect(baseUrl('http://host:8096')).toBe('http://host:8096');
  });

  it('adds http:// to a legacy schemeless host loaded from the database', () => {
    expect(baseUrl('jellyfin:8096')).toBe('http://jellyfin:8096');
  });
});

describe('createAuthedFetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('get() sends the auth header under the configured header name and joins the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { get } = createAuthedFetcher('Jellyfin', 'X-Emby-Token');
    const result = await get(fakeConnector({ host: 'http://host:8096/' }), '/Users');

    expect(result).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host:8096/Users',
      expect.objectContaining({
        headers: { Accept: 'application/json', 'X-Emby-Token': 'secret-token' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('supports provider-specific token formatting for modern authorization schemes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { get } = createAuthedFetcher(
      'Jellyfin',
      'Authorization',
      (token) => `MediaBrowser Token="${token}"`,
    );
    await get(fakeConnector(), '/System/Info');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'MediaBrowser Token="secret-token"',
    );
  });

  it('get() throws with the provider label and status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    );

    const { get } = createAuthedFetcher('Plex', 'X-Plex-Token');
    await expect(get(fakeConnector(), '/library/sections')).rejects.toThrow('Plex request failed: 404 Not Found');
  });

  it('send() includes a JSON content-type header only when a body is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const { send } = createAuthedFetcher('Jellyfin', 'X-Emby-Token');
    await send(fakeConnector(), 'DELETE', '/Items/123');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('send() returns null for a 204 response without attempting to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));

    const { send } = createAuthedFetcher('Jellyfin', 'X-Emby-Token');
    const result = await send(fakeConnector(), 'POST', '/Playlists', { Name: 'test' });
    expect(result).toBeNull();
  });

  it('send() parses a non-empty JSON body on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"Id":"abc"}' }),
    );

    const { send } = createAuthedFetcher('Jellyfin', 'X-Emby-Token');
    const result = await send(fakeConnector(), 'POST', '/Playlists', { Name: 'test' });
    expect(result).toEqual({ Id: 'abc' });
  });

  // getBinary() exists so Plex's and Jellyfin's fetchVideoThumbnail can share
  // the exact same auth-header construction as get()/send() instead of each
  // hand-building it — the duplication that made the Jellyfin-12 auth-scheme
  // fix land in one spot but not the other originally.
  describe('getBinary()', () => {
    it('sends the same formatted auth header as get()/send()', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
      vi.stubGlobal('fetch', fetchMock);

      const { getBinary } = createAuthedFetcher(
        'Jellyfin',
        'Authorization',
        (token) => `MediaBrowser Token="${token}"`,
      );
      const result = await getBinary(fakeConnector(), '/Items/1/Images/Primary');

      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('MediaBrowser Token="secret-token"');
      expect(result).toEqual({ contentType: 'image/png', data: Buffer.from([1, 2, 3]) });
    });

    it('returns null on a 404 instead of throwing — "no thumbnail" is not an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

      const { getBinary } = createAuthedFetcher('Plex', 'X-Plex-Token');
      await expect(getBinary(fakeConnector(), '/library/metadata/1/thumb')).resolves.toBeNull();
    });

    it('throws with the provider label on a non-404 error status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }));

      const { getBinary } = createAuthedFetcher('Plex', 'X-Plex-Token');
      await expect(getBinary(fakeConnector(), '/library/metadata/1/thumb')).rejects.toThrow(
        'Plex request failed: 500 Server Error',
      );
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryConnector } from '@prisma/client';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';

function connector(overrides: Partial<LibraryConnector> = {}): LibraryConnector {
  return {
    id: 1,
    name: 'Jellyfin',
    type: 'jellyfin',
    host: 'jellyfin:8096',
    authToken: 'token',
    username: 'admin',
    password: null,
    userId: 'user-1',
    musicLibraryId: 'music-1',
    videoLibraryId: 'video-1',
    enabled: true,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('jellyfinProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves the Jellyfin user separately from the selected music library', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Version: '12.1.0' }))
      .mockResolvedValueOnce(jsonResponse([{ Id: 'resolved-user', Name: 'Admin' }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(jellyfinProvider.testConnection(connector({ userId: null }))).resolves.toEqual({
      ok: true,
      userId: 'resolved-user',
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'MediaBrowser Token="token"',
    });
  });

  it('scopes artist sync to both the resolved user and selected music library', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ Items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await jellyfinProvider.fetchArtists(connector());

    expect(fetchMock.mock.calls[0][0]).toContain('/Users/user-1/Items?');
    expect(fetchMock.mock.calls[0][0]).toContain('ParentId=music-1');
  });

  it('scans music videos with metadata and thumbnail availability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      Items: [{ Id: 'video-7', Name: 'The Song', Artists: ['The Artist'], ProductionYear: 2024,
        Path: '/videos/song.mkv', UserData: { PlayCount: 3 }, ImageTags: { Primary: 'tag' } }],
      TotalRecordCount: 1,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(jellyfinProvider.fetchVideos!(connector())).resolves.toEqual([{
      externalId: 'video-7', title: 'The Song', artistName: 'The Artist', releaseYear: 2024,
      path: '/videos/song.mkv', playCount: 3, hasThumbnail: true,
    }]);
    expect(fetchMock.mock.calls[0][0]).toContain('ParentId=video-1');
  });

  it('creates the replacement playlist before deleting the existing one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Items: [{ Id: 'video-item', Name: 'Song', Artists: ['Artist'] }] }))
      .mockResolvedValueOnce(jsonResponse({ Id: 'new-playlist' }))
      .mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await jellyfinProvider.pushPlaylist!(connector(), {
      name: 'Favorites',
      items: [{ artistName: 'Artist', title: 'Song' }],
      existingRemoteId: 'old-playlist',
    });

    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'POST', 'DELETE']);
    expect(fetchMock.mock.calls[1][0]).toBe('http://jellyfin:8096/Playlists');
    expect(fetchMock.mock.calls[2][0]).toBe('http://jellyfin:8096/Items/old-playlist');
  });

  it('fetches a video thumbnail using the same MediaBrowser auth header as every other call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'image/jpeg']]),
      arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await jellyfinProvider.fetchVideoThumbnail!(connector(), 'video-7');

    expect(result).toEqual({ contentType: 'image/jpeg', data: Buffer.from([9, 9]) });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://jellyfin:8096/Items/video-7/Images/Primary?maxWidth=640&quality=85',
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('MediaBrowser Token="token"');
  });

  it('returns null for a video with no thumbnail instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(jellyfinProvider.fetchVideoThumbnail!(connector(), 'video-7')).resolves.toBeNull();
  });

  // Regression test for a real bug: when Jellyfin's response omits
  // TotalRecordCount, the old stop condition fell back to comparing
  // videos.length against itself (`videos.length >= videos.length`), which
  // is trivially true — pagination silently stopped after the very first
  // page even though a full page (more results pending) had just come back.
  it('keeps paginating past a full page when TotalRecordCount is missing from the response', async () => {
    // The page-size limit is hardcoded to 500 in fetchVideos — a page has to
    // come back exactly that full for the old buggy stop condition
    // (`items.length < limit`) to fall through to the broken
    // TotalRecordCount fallback at all.
    const fullPage = Array.from({ length: 500 }, (_, i) => ({ Id: `v${i}`, Name: `Song ${i}`, Artists: ['Artist'] }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Items: fullPage })) // no TotalRecordCount
      .mockResolvedValueOnce(jsonResponse({ Items: [{ Id: 'v500', Name: 'Song 500', Artists: ['Artist'] }] }));
    vi.stubGlobal('fetch', fetchMock);

    const videos = await jellyfinProvider.fetchVideos!(connector());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(videos).toHaveLength(501);
    expect(videos[500].externalId).toBe('v500');
  });

  it('preserves the existing playlist when creating its replacement fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      jellyfinProvider.pushPlaylist!(connector(), {
        name: 'Favorites',
        items: [],
        existingRemoteId: 'old-playlist',
      }),
    ).rejects.toThrow('Jellyfin request failed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });
});

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

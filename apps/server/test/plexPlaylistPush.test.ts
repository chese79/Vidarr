import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryConnector } from '@prisma/client';
import { plexProvider } from '../src/providers/library/plex.js';

afterEach(() => vi.unstubAllGlobals());

describe('Plex playlist replacement', () => {
  it('keeps the existing playlist when a replacement item cannot be matched', async () => {
    const connector = { type: 'plex', host: 'http://plex:32400', authToken: 'token', videoLibraryId: '1' } as LibraryConnector;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ MediaContainer: { Metadata: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(plexProvider.pushPlaylist!(connector, {
      name: 'Favorites', items: [{ artistName: 'Artist', title: 'Missing' }], existingRemoteId: 'old-playlist',
    })).rejects.toThrow('Keeping the existing Plex playlist');
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });
});

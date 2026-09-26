import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryConnector } from '@prisma/client';
import { plexProvider } from '../src/providers/library/plex.js';

afterEach(() => vi.unstubAllGlobals());

describe('Plex playlist replacement', () => {
  const connector = { type: 'plex', host: 'http://plex:32400', authToken: 'token', videoLibraryId: '1' } as LibraryConnector;

  it('keeps the existing playlist when a replacement item cannot be matched', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ MediaContainer: { Metadata: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(plexProvider.pushPlaylist!(connector, {
      name: 'Favorites', items: [{ artistName: 'Artist', title: 'Missing' }], existingRemoteId: 'old-playlist',
    })).rejects.toThrow('Keeping the existing Plex playlist');
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });

  it('rejects duplicate exact titles instead of selecting the first Plex video', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ MediaContainer: { Metadata: [
        { ratingKey: 10, title: 'Same Song' }, { ratingKey: 11, title: 'Same Song' },
      ] } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(plexProvider.findLibraryItem!(connector, { artistName: 'Artist', title: 'Same Song' })).resolves.toBeNull();
  });

  it('accepts a single exact title with an item id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ MediaContainer: { Metadata: [
        { ratingKey: 10, title: 'Another Song' }, { ratingKey: 11, title: 'Same Song', viewCount: 2 },
      ] } }) }));
    await expect(plexProvider.findLibraryItem!(connector, { artistName: 'Artist', title: 'Same Song' }))
      .resolves.toEqual({ id: '11', playCount: 2 });
  });
});

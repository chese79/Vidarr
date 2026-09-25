import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import {
  resetDb,
  ensureSettings,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
  createMusicVideoFile,
  createLibraryConnector,
  createLibraryVideo,
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

// Mocks a fetch() Response carrying an image body, matching the shape
// pipeline/safeImageFetch.ts actually reads from: a streamed `body` (via
// getReader/read/cancel), not `arrayBuffer()` — the posterUrl proxy path
// reads the stream incrementally to enforce its size cap.
function mockImageResponse(
  data: Uint8Array,
  overrides: Partial<{ contentType: string; ok: boolean; contentLength: string }> = {},
) {
  let delivered = false;
  const headers = new Map<string, string>([['content-type', overrides.contentType ?? 'image/jpeg']]);
  if (overrides.contentLength) headers.set('content-length', overrides.contentLength);
  return {
    ok: overrides.ok ?? true,
    headers,
    body: {
      getReader: () => ({
        read: async () => {
          if (delivered) return { done: true, value: undefined };
          delivered = true;
          return { done: false, value: data };
        },
        cancel: async () => {},
      }),
    },
  };
}

describe('artist routes', () => {
  let app: FastifyInstance;
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('GET /api/v1/artist lists artists sorted by sortName', async () => {
    await createArtist(rootFolderId, qualityProfileId, { name: 'Zebra', sortName: 'Zebra' });
    await createArtist(rootFolderId, qualityProfileId, { name: 'Apple', sortName: 'Apple' });

    const res = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((a: { name: string }) => a.name);
    expect(names).toEqual(['Apple', 'Zebra']);
  });

  it('GET /api/v1/artist/:id returns the artist with its videos included', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);

    const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: artist.id, name: artist.name, musicVideos: [] });
  });

  it('GET /api/v1/artist/:id/videos returns the lightweight accordion catalog with derived status', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id, { title: 'Accordion Video' });
    await prisma.musicVideo.update({ where: { id: video.id }, data: { director: 'Director' } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/videos`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({
      id: video.id,
      title: 'Accordion Video',
      director: 'Director',
      status: expect.objectContaining({ ownership: 'none', eligibleForAutoSearch: true }),
    })]);
    expect(res.json()[0]).not.toHaveProperty('acquisitionSources');
  });

  it('GET /api/v1/artist/:id includes each video\'s available, matched media-server videos', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id, { title: 'Matched Video', hasFile: false });
    const connector = await createLibraryConnector({ name: 'My Jellyfin', type: 'jellyfin', enabled: true });
    await createLibraryVideo(connector.id, {
      musicVideoId: video.id,
      available: true,
      playCount: 9,
      externalId: 'ext-a',
    });
    // A stale match from a previous sync (no longer available) shouldn't show as owned.
    await createLibraryVideo(connector.id, {
      musicVideoId: video.id,
      available: false,
      externalId: 'ext-b',
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const returnedVideo = res.json().musicVideos.find((v: { id: number }) => v.id === video.id);
    expect(returnedVideo.libraryVideos).toHaveLength(1);
    expect(returnedVideo.libraryVideos[0]).toMatchObject({
      playCount: 9,
      connector: { name: 'My Jellyfin', type: 'jellyfin' },
    });
  });

  it('GET /api/v1/artist/:id 404s for a nonexistent id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/artist/999999', headers: authHeaders() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Artist not found' });
  });

  it('POST /api/v1/artist creates an artist and derives sortName (stripping a leading "The")', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: 'The Beatles', rootFolderId, qualityProfileId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'The Beatles', sortName: 'Beatles', monitored: false, genre: null });
  });

  // A newly added artist shouldn't start auto-downloading its whole catalog
  // just from being added — this is the actual behavior a "default" is for,
  // not just the literal field value, so assert it explicitly rather than
  // folding it into the test above.
  it('POST /api/v1/artist defaults a new artist to unmonitored when the field is omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: 'Omitted Field Artist', rootFolderId, qualityProfileId },
    });
    expect(res.json().monitored).toBe(false);
  });

  it('POST /api/v1/artist still honors an explicit monitored: true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: 'Explicitly Monitored Artist', rootFolderId, qualityProfileId, monitored: true },
    });
    expect(res.json().monitored).toBe(true);
  });

  it('POST /api/v1/artist rejects a missing required field with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { rootFolderId, qualityProfileId }, // missing name
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ValidationError');
  });

  it('POST /api/v1/artist rejects an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: '', rootFolderId, qualityProfileId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/artist persists an explicit genre', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: 'Genre Artist', rootFolderId, qualityProfileId, genre: 'Synthpop' },
    });
    expect(res.json().genre).toBe('Synthpop');
  });

  it('PUT /api/v1/artist/:id updating an unrelated field never resets an existing monitored value', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Stays Monitored', monitored: true });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { genre: 'Shoegaze' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitored).toBe(true);
  });

  it('PUT /api/v1/artist/:id updates fields and re-derives sortName from a new name', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Old Name' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { name: 'An Updated Name' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'An Updated Name', sortName: 'Updated Name' });
  });

  it('PUT /api/v1/artist/:id toggling monitored on skips the metadata refresh when there is no imvdbArtistId', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Unmonitored' });
    await ensureSettings({ apiKey: TEST_API_KEY }); // no-op, keeps intent explicit
    // start unmonitored
    await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { monitored: false },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { monitored: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitored).toBe(true);
    expect(res.json().videosAdded).toBeUndefined();
    expect(res.json().metadataRefreshError).toBeUndefined();
  });

  it('PUT /api/v1/artist/:id 404s (via the shared P2025 handler) for a nonexistent id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/artist/999999',
      headers: authHeaders(),
      payload: { name: 'Does not matter' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/v1/artist/:id removes the artist', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(get.statusCode).toBe(404);
  });

  it('POST /api/v1/artist/:id/match-genre 404s cleanly when no provider has genre data (no providers enabled)', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'No Match Artist' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/artist/${artist.id}/match-genre`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('No standard genre match found');
  });

  describe('GET /api/v1/artist/summary', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('computes known/available/missing/downloading counts and aggregate play count in one pass', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Counted Artist' });
      const owned = await createMusicVideo(artist.id, { title: 'Owned', hasFile: true });
      await createMusicVideoFile(owned.id, { playCount: 5 });
      await createMusicVideo(artist.id, { title: 'Wanted', hasFile: false });
      const downloading = await createMusicVideo(artist.id, { title: 'Downloading', hasFile: false });
      await prisma.downloadQueueItem.create({
        data: { musicVideoId: downloading.id, sourceType: 'indexer', sourceRef: 'x', status: 'downloading' },
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      const item = res.json().items.find((i: { id: number }) => i.id === artist.id);
      expect(item).toMatchObject({
        knownVideoCount: 3,
        availableVideoCount: 1,
        missingVideoCount: 2,
        downloadingVideoCount: 1,
        aggregatePlayCount: 5,
      });
    });

    it('reports aggregatePlayCount as null (not 0) when no video has play-count data', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'No Play Data' });
      await createMusicVideo(artist.id, { hasFile: false });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
      const item = res.json().items.find((i: { id: number }) => i.id === artist.id);
      expect(item.aggregatePlayCount).toBeNull();
    });

    it('combines search, genre, and monitored filters with AND semantics', async () => {
      await createArtist(rootFolderId, qualityProfileId, { name: 'Match Rock', genre: 'Rock', monitored: true });
      await createArtist(rootFolderId, qualityProfileId, { name: 'Match Pop', genre: 'Pop', monitored: true });
      await createArtist(rootFolderId, qualityProfileId, { name: 'Other Rock', genre: 'Rock', monitored: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/artist/summary?search=Match&genre=Rock&monitored=true',
        headers: authHeaders(),
      });
      const names = res.json().items.map((i: { name: string }) => i.name);
      expect(names).toEqual(['Match Rock']);
    });

    it('filters by the A-Z rail letter, bucketing non-alphabetic sort names under "#"', async () => {
      await createArtist(rootFolderId, qualityProfileId, { name: 'Apple', sortName: 'Apple' });
      await createArtist(rootFolderId, qualityProfileId, { name: '3 Doors Down', sortName: '3 Doors Down' });

      const letterA = await app.inject({ method: 'GET', url: '/api/v1/artist/summary?letter=A', headers: authHeaders() });
      expect(letterA.json().items.map((i: { name: string }) => i.name)).toEqual(['Apple']);

      const letterHash = await app.inject({ method: 'GET', url: '/api/v1/artist/summary?letter=%23', headers: authHeaders() });
      expect(letterHash.json().items.map((i: { name: string }) => i.name)).toEqual(['3 Doors Down']);
    });

    it('reports availableLetters from the full unfiltered set, not the current filter', async () => {
      await createArtist(rootFolderId, qualityProfileId, { name: 'Apple', sortName: 'Apple' });
      await createArtist(rootFolderId, qualityProfileId, { name: 'Zebra', sortName: 'Zebra' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary?letter=A', headers: authHeaders() });
      expect(res.json().availableLetters).toEqual(['A', 'Z']);
    });

    it('filters by minKnownVideos and hasMissing after counts are computed', async () => {
      const complete = await createArtist(rootFolderId, qualityProfileId, { name: 'Complete' });
      await createMusicVideo(complete.id, { hasFile: true });
      const incomplete = await createArtist(rootFolderId, qualityProfileId, { name: 'Incomplete' });
      await createMusicVideo(incomplete.id, { hasFile: false });
      await createArtist(rootFolderId, qualityProfileId, { name: 'Empty' });

      const missingOnly = await app.inject({
        method: 'GET',
        url: '/api/v1/artist/summary?hasMissing=true',
        headers: authHeaders(),
      });
      expect(missingOnly.json().items.map((i: { name: string }) => i.name)).toEqual(['Incomplete']);

      const atLeastOneVideo = await app.inject({
        method: 'GET',
        url: '/api/v1/artist/summary?minKnownVideos=1',
        headers: authHeaders(),
      });
      const names = atLeastOneVideo.json().items.map((i: { name: string }) => i.name).sort();
      expect(names).toEqual(['Complete', 'Incomplete']);
    });

    it('paginates and reports a total independent of the current page size', async () => {
      for (let i = 0; i < 5; i += 1) {
        await createArtist(rootFolderId, qualityProfileId, { name: `Artist ${i}`, sortName: `Artist ${i}` });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/artist/summary?page=2&pageSize=2',
        headers: authHeaders(),
      });
      expect(res.json()).toMatchObject({ total: 5, page: 2, pageSize: 2 });
      expect(res.json().items).toHaveLength(2);
    });

    it('flags hasImage true when a matching enabled connector has synced a LibraryArtist with this name', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Synced Artist' });
      const connector = await createLibraryConnector({ enabled: true });
      await prisma.libraryArtist.create({
        data: {
          connectorId: connector.id,
          externalId: 'ext-1',
          name: 'Synced Artist',
          normalizedName: 'synced artist',
        },
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
      const item = res.json().items.find((i: { id: number }) => i.id === artist.id);
      expect(item.hasImage).toBe(true);
    });

    it('counts a media-server-matched video with no local file as available, and uses its play count', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Server Only Artist' });
      const video = await createMusicVideo(artist.id, { title: 'Server Only', hasFile: false });
      const connector = await createLibraryConnector({ enabled: true });
      await createLibraryVideo(connector.id, { musicVideoId: video.id, available: true, playCount: 12 });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
      const item = res.json().items.find((i: { id: number }) => i.id === artist.id);
      expect(item).toMatchObject({
        knownVideoCount: 1,
        availableVideoCount: 1,
        missingVideoCount: 0,
        aggregatePlayCount: 12,
      });
    });

    it('does not count a matched LibraryVideo that the last sync marked unavailable', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Stale Match Artist' });
      const video = await createMusicVideo(artist.id, { title: 'Removed From Server', hasFile: false });
      const connector = await createLibraryConnector({ enabled: true });
      await createLibraryVideo(connector.id, { musicVideoId: video.id, available: false, playCount: 7 });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
      const item = res.json().items.find((i: { id: number }) => i.id === artist.id);
      expect(item).toMatchObject({ availableVideoCount: 0, missingVideoCount: 1, aggregatePlayCount: null });
    });

    it('prefers the locally synced file play count over a matched LibraryVideo when a file exists', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Both Sources Artist' });
      const video = await createMusicVideo(artist.id, { title: 'Owned And Matched', hasFile: true });
      await createMusicVideoFile(video.id, { playCount: 40 });
      const connector = await createLibraryConnector({ enabled: true });
      await createLibraryVideo(connector.id, { musicVideoId: video.id, available: true, playCount: 999 });

      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
      const item = res.json().items.find((i: { id: number }) => i.id === artist.id);
      expect(item.aggregatePlayCount).toBe(40);
    });
  });

  describe('GET /api/v1/artist/:id/image', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('404s when there is no posterUrl and no matching connector artist', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'No Image Artist' });
      const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });

    it('404s for a nonexistent artist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/artist/999999/image', headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });

    it('proxies posterUrl when set, never redirecting the browser to the original URL', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Poster Artist' });
      await prisma.artist.update({ where: { id: artist.id }, data: { posterUrl: 'https://imvdb.example/img.jpg' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockImageResponse(new Uint8Array([1, 2, 3]))));

      const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('refuses a posterUrl with a non-http(s) scheme instead of fetching it', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'File Scheme Artist' });
      await prisma.artist.update({ where: { id: artist.id }, data: { posterUrl: 'file:///etc/passwd' } });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
      expect(res.statusCode).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a posterUrl pointing at a loopback/private/link-local address instead of fetching it', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'SSRF Target Artist' });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      for (const target of [
        'http://127.0.0.1:9/x',
        'http://169.254.169.254/latest/meta-data/',
        'http://192.168.1.5/x',
        'http://localhost:9/x',
      ]) {
        await prisma.artist.update({ where: { id: artist.id }, data: { posterUrl: target } });
        const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
        expect(res.statusCode).toBe(404);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a posterUrl response whose content-type is not an image', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Non Image Response Artist' });
      await prisma.artist.update({ where: { id: artist.id }, data: { posterUrl: 'https://imvdb.example/img.jpg' } });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockImageResponse(new TextEncoder().encode('<html></html>'), { contentType: 'text/html' })),
      );

      const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });

    it('refuses a posterUrl response whose declared size exceeds the cap without reading the body', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Oversized Response Artist' });
      await prisma.artist.update({ where: { id: artist.id }, data: { posterUrl: 'https://imvdb.example/img.jpg' } });
      const response = mockImageResponse(new Uint8Array([1]), { contentLength: String(50 * 1024 * 1024) });
      const readSpy = vi.spyOn(response.body, 'getReader');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
      expect(res.statusCode).toBe(404);
      expect(readSpy).not.toHaveBeenCalled();
    });

    it('falls back to a matched connector image when posterUrl is unset', async () => {
      const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Connector Image Artist' });
      const connector = await createLibraryConnector({ type: 'jellyfin', enabled: true });
      await prisma.libraryArtist.create({
        data: {
          connectorId: connector.id,
          externalId: 'jf-artist-1',
          name: 'Connector Image Artist',
          normalizedName: 'connector image artist',
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'image/png']]),
          arrayBuffer: async () => new Uint8Array([9]).buffer,
        }),
      );

      const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/image`, headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });
  });

  describe('POST /api/v1/artist/bulk-monitor', () => {
    it('monitors every id in the list', async () => {
      const a = await createArtist(rootFolderId, qualityProfileId, { name: 'A', monitored: false });
      const b = await createArtist(rootFolderId, qualityProfileId, { name: 'B', monitored: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/artist/bulk-monitor',
        headers: authHeaders(),
        payload: { ids: [a.id, b.id], monitored: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().succeeded.sort()).toEqual([a.id, b.id].sort());
      expect(res.json().failed).toEqual([]);

      const refreshed = await prisma.artist.findUnique({ where: { id: a.id } });
      expect(refreshed?.monitored).toBe(true);
    });

    it('reports a bad id as a partial failure instead of failing the whole batch', async () => {
      const a = await createArtist(rootFolderId, qualityProfileId, { name: 'Real Artist', monitored: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/artist/bulk-monitor',
        headers: authHeaders(),
        payload: { ids: [a.id, 999999], monitored: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().succeeded).toEqual([a.id]);
      expect(res.json().failed).toHaveLength(1);
      expect(res.json().failed[0].id).toBe(999999);

      const refreshed = await prisma.artist.findUnique({ where: { id: a.id } });
      expect(refreshed?.monitored).toBe(true);
    });

    it('rejects an empty id list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/artist/bulk-monitor',
        headers: authHeaders(),
        payload: { ids: [], monitored: true },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

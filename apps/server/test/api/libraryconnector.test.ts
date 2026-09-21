import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  resetDb,
  ensureSettings,
  createLibraryConnector,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';
import { prisma } from '../../src/db/client.js';

describe('libraryconnector routes', () => {
  let app: FastifyInstance;

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/v1/libraryconnector creates a connector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'My Jellyfin', type: 'jellyfin', host: 'http://jellyfin:8096' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'My Jellyfin', type: 'jellyfin', enabled: true });
  });

  it('never returns connector tokens or passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: {
        name: 'Secret connector',
        type: 'jellyfin',
        host: 'jellyfin:8096',
        authToken: 'connector-secret',
        password: 'connector-password',
      },
    });

    expect(res.json()).toMatchObject({ authToken: null, hasAuthToken: true });
    expect(res.json()).not.toHaveProperty('password');
    expect(JSON.stringify(res.json())).not.toContain('connector-secret');
    expect(JSON.stringify(res.json())).not.toContain('connector-password');
  });

  it('POST /api/v1/libraryconnector prepends http:// to a bare host — a schemeless host makes every request fail with "Failed to parse URL"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'JF', type: 'jellyfin', host: '192.168.0.8:8096' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().host).toBe('http://192.168.0.8:8096');
  });

  it('POST /api/v1/libraryconnector leaves a host that already has a scheme untouched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'Secure Plex', type: 'plex', host: 'https://plex.example.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().host).toBe('https://plex.example.com');
  });

  it('POST /api/v1/libraryconnector rejects an invalid type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'Bad', type: 'napster', host: 'http://x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/libraryconnector lists connectors', async () => {
    await createLibraryConnector({ name: 'A' });
    await createLibraryConnector({ name: 'B' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/libraryconnector', headers: authHeaders() });
    expect(res.json()).toHaveLength(2);
  });

  it('GET /api/v1/libraryvideo exposes scanned videos with connector metadata', async () => {
    const connector = await createLibraryConnector({ name: 'Living Room Jellyfin' });
    await prisma.libraryVideo.create({ data: {
      connectorId: connector.id, externalId: 'jf-video-1', title: 'Song', normalizedTitle: 'song',
      artistName: 'Artist', normalizedArtistName: 'artist', hasThumbnail: true,
    } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/libraryvideo', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({
      title: 'Song', artistName: 'Artist', hasThumbnail: true,
      connector: { name: 'Living Room Jellyfin', type: 'jellyfin' },
    })]);
  });

  it('PUT /api/v1/libraryconnector/:id updates fields', async () => {
    const connector = await createLibraryConnector();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
      payload: { videoLibraryId: 'section-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().videoLibraryId).toBe('section-2');
  });

  it('PUT /api/v1/libraryconnector/:id also normalizes a schemeless host', async () => {
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
      payload: { host: '192.168.0.8:8096' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().host).toBe('http://192.168.0.8:8096');
  });

  it('PUT /api/v1/libraryconnector/:id updates host/token/username — fixing a bad credential without deleting the row', async () => {
    const connector = await createLibraryConnector({ name: 'My Jellyfin', type: 'jellyfin', host: 'http://old-host:8096' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
      payload: { host: 'http://new-host:8096', authToken: 'new-token', username: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ host: 'http://new-host:8096', authToken: null, hasAuthToken: true, username: 'admin' });
    expect(JSON.stringify(res.json())).not.toContain('new-token');
  });

  it('DELETE /api/v1/libraryconnector/:id removes it', async () => {
    const connector = await createLibraryConnector();
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });

  it('GET /api/v1/libraryconnector/:id/sections 404s for a nonexistent connector', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/libraryconnector/999999/sections',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/libraryconnector/:id/test 404s for a nonexistent connector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/999999/test',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/libraryconnector/:id/sync 404s for a nonexistent connector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/999999/sync',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not wipe existing library artists when a sync returns zero artists', async () => {
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { userId: 'user-1', musicLibraryId: 'music-1' },
    });
    await prisma.libraryArtist.create({
      data: {
        connectorId: connector.id,
        externalId: 'a1',
        name: 'Old Artist',
        normalizedName: 'old artist',
        lastSyncedAt: new Date(0),
      },
    });

    // An empty result from the remote server (auth hiccup, momentarily-empty
    // response, a renamed section) must never be read as "the library is now
    // empty" — that would wipe every previously-synced artist on one bad
    // response.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ Items: [] }) }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().artistCount).toBe(0);

    const remaining = await prisma.libraryArtist.findMany({ where: { connectorId: connector.id } });
    expect(remaining).toHaveLength(1);
  });

  it('POST /:id/test does not overwrite an already-chosen musicLibraryId with its own guess', async () => {
    const connector = await createLibraryConnector({ type: 'plex' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { musicLibraryId: 'manually-chosen-section' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ MediaContainer: { Directory: [{ type: 'artist', key: 'guessed-section' }] } }),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/test`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.libraryConnector.findUnique({ where: { id: connector.id } });
    expect(updated?.musicLibraryId).toBe('manually-chosen-section');
  });

  it('rolls back the video-availability reset atomically when a sync fails partway through', async () => {
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { userId: 'user-1', musicLibraryId: 'music-1', videoLibraryId: 'video-1' },
    });
    await prisma.libraryVideo.create({
      data: {
        connectorId: connector.id,
        externalId: 'v1',
        title: 'Old Song',
        normalizedTitle: 'old song',
        artistName: 'Old Artist',
        normalizedArtistName: 'old artist',
        available: true,
      },
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        // fetchArtists
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) })
        // fetchVideos — one item with no Name, so normalizeTitle(undefined)
        // throws while building the upsert batch, after the "mark everything
        // unavailable" step has already been queued but before anything commits.
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ Items: [{ Id: 'bad-video', Artists: ['Artist'] }], TotalRecordCount: 1 }),
        }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(502);

    const video = await prisma.libraryVideo.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId: 'v1' } },
    });
    expect(video?.available).toBe(true);
  });

  it('preserves an existing LibraryVideo match across a sync where the title no longer resolves the exact-match key', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Original Title' });

    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { userId: 'user-1', musicLibraryId: 'music-1', videoLibraryId: 'video-1' },
    });

    const artistsPage = { ok: true, status: 200, json: async () => ({ Items: [] }) };
    const firstVideosPage = {
      ok: true,
      status: 200,
      json: async () => ({
        Items: [{ Id: 'ext-1', Name: 'Original Title', Artists: ['Test Artist'] }],
        TotalRecordCount: 1,
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(artistsPage).mockResolvedValueOnce(firstVideosPage));

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(first.statusCode).toBe(200);

    const afterFirstSync = await prisma.libraryVideo.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId: 'ext-1' } },
    });
    expect(afterFirstSync?.musicVideoId).toBe(video.id);

    // Second sync: same externalId, but the title reported by the server no
    // longer matches (a rename upstream) — the exact-match key now misses.
    const secondVideosPage = {
      ok: true,
      status: 200,
      json: async () => ({
        Items: [{ Id: 'ext-1', Name: 'Renamed Title', Artists: ['Test Artist'] }],
        TotalRecordCount: 1,
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(artistsPage).mockResolvedValueOnce(secondVideosPage));

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(second.statusCode).toBe(200);

    const afterSecondSync = await prisma.libraryVideo.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId: 'ext-1' } },
    });
    // The previous match must be preserved, not silently dropped to null.
    expect(afterSecondSync?.musicVideoId).toBe(video.id);
    expect(afterSecondSync?.title).toBe('Renamed Title'); // other fields still refresh normally
  });

  it('a genuinely new match found this sync still overrides a stale previous one', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Test Artist' });
    const oldVideo = await createMusicVideo(artist.id, { title: 'Old Match' });
    const newVideo = await createMusicVideo(artist.id, { title: 'New Match' });

    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { userId: 'user-1', musicLibraryId: 'music-1', videoLibraryId: 'video-1' },
    });
    // Seed a prior match directly, as if an earlier sync had matched to the old video.
    await prisma.libraryVideo.create({
      data: {
        connectorId: connector.id,
        externalId: 'ext-2',
        title: 'New Match',
        normalizedTitle: 'new match',
        artistName: 'Test Artist',
        normalizedArtistName: 'test artist',
        available: true,
        musicVideoId: oldVideo.id,
      },
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            Items: [{ Id: 'ext-2', Name: 'New Match', Artists: ['Test Artist'] }],
            TotalRecordCount: 1,
          }),
        }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.libraryVideo.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId: 'ext-2' } },
    });
    expect(updated?.musicVideoId).toBe(newVideo.id);
  });

  it('a sync classifies a near-miss title as a probable match needing review, with a comparison payload', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights', releaseYear: 2019 });

    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { userId: 'user-1', musicLibraryId: 'music-1', videoLibraryId: 'video-1' },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            Items: [
              {
                Id: 'ext-1',
                Name: 'Blinding Lights Official Video',
                Artists: ['Test Artist'],
                ProductionYear: 2019,
              },
            ],
            TotalRecordCount: 1,
          }),
        }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/libraryvideo', headers: authHeaders() });
    const row = listRes.json().find((v: { externalId: string }) => v.externalId === 'ext-1');
    expect(row).toMatchObject({
      musicVideoId: video.id,
      matchConfidence: 'probable',
      matchedVideo: { title: 'Blinding Lights', releaseYear: 2019, artistName: 'Test Artist' },
    });
  });

  it('POST /api/v1/libraryvideo/:id/confirm-match clears matchConfidence, keeping the match', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    const libraryVideo = await prisma.libraryVideo.create({
      data: {
        connectorId: connector.id,
        externalId: 'ext-1',
        title: 'Blinding Lights Official Video',
        normalizedTitle: 'blinding lights official video',
        artistName: 'Test Artist',
        normalizedArtistName: 'test artist',
        available: true,
        musicVideoId: video.id,
        matchConfidence: 'probable',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryvideo/${libraryVideo.id}/confirm-match`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.libraryVideo.findUnique({ where: { id: libraryVideo.id } });
    expect(updated).toMatchObject({ musicVideoId: video.id, matchConfidence: null });
  });

  it('POST /api/v1/libraryvideo/:id/reject-match clears the match and remembers it was rejected', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    const libraryVideo = await prisma.libraryVideo.create({
      data: {
        connectorId: connector.id,
        externalId: 'ext-1',
        title: 'Blinding Lights Official Video',
        normalizedTitle: 'blinding lights official video',
        artistName: 'Test Artist',
        normalizedArtistName: 'test artist',
        available: true,
        musicVideoId: video.id,
        matchConfidence: 'probable',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryvideo/${libraryVideo.id}/reject-match`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.libraryVideo.findUnique({ where: { id: libraryVideo.id } });
    expect(updated).toMatchObject({ musicVideoId: null, matchConfidence: null, rejectedMusicVideoId: video.id });
  });

  it('a rejected match is not re-proposed by the next sync', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({
      where: { id: connector.id },
      data: { userId: 'user-1', musicLibraryId: 'music-1', videoLibraryId: 'video-1' },
    });
    // Seed as already-rejected, as if a human rejected it after an earlier sync.
    await prisma.libraryVideo.create({
      data: {
        connectorId: connector.id,
        externalId: 'ext-1',
        title: 'Blinding Lights Official Video',
        normalizedTitle: 'blinding lights official video',
        artistName: 'Test Artist',
        normalizedArtistName: 'test artist',
        available: false,
        musicVideoId: null,
        rejectedMusicVideoId: video.id,
      },
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            Items: [{ Id: 'ext-1', Name: 'Blinding Lights Official Video', Artists: ['Test Artist'] }],
            TotalRecordCount: 1,
          }),
        }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/libraryconnector/${connector.id}/sync`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.libraryVideo.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId: 'ext-1' } },
    });
    expect(updated?.musicVideoId).toBeNull();
    expect(updated?.rejectedMusicVideoId).toBe(video.id);
  });

  it('POST /api/v1/libraryconnector/:id/sync-play-counts propagates a real error as 502, not 500', async () => {
    // No real connector exists at this id at all — syncPlayCounts will fail
    // trying to look it up, and the route must translate that into a clean
    // 502 rather than letting an unhandled rejection surface as a 500.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/999999/sync-play-counts',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(502);
  });
});

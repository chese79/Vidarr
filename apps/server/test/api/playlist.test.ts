import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
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
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('playlist routes', () => {
  let app: FastifyInstance;
  let artistId: number;

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
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    artistId = (await createArtist(rootFolder.id, qualityProfile.id)).id;
  });

  it('POST /api/v1/playlist creates an empty playlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist',
      headers: authHeaders(),
      payload: { name: 'My Playlist' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'My Playlist', items: [], syncs: [] });
  });

  it('POST /api/v1/playlist rejects an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist',
      headers: authHeaders(),
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/playlist/generate wires through to the real filter pipeline', async () => {
    const video = await createMusicVideo(artistId, { title: 'Matched', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(video.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist/generate',
      headers: authHeaders(),
      payload: { name: 'Generated', filters: { yearMin: 1990 }, matchMode: 'all' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ matchedCount: 1 });
  });

  it('POST /api/v1/playlist/generate rejects an invalid matchMode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist/generate',
      headers: authHeaders(),
      payload: { name: 'Bad', filters: {}, matchMode: 'xor' },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('playlist items', () => {
    let playlistId: number;
    let videoId: number;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/playlist',
        headers: authHeaders(),
        payload: { name: 'Items Playlist' },
      });
      playlistId = created.json().id;
      const video = await createMusicVideo(artistId, { title: 'Item Video', hasFile: true });
      videoId = video.id;
    });

    it('adds an item and lists it back in the playlist', async () => {
      const add = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      expect(add.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: '/api/v1/playlist', headers: authHeaders() });
      const playlist = list.json().find((p: { id: number }) => p.id === playlistId);
      expect(playlist.items).toHaveLength(1);
      expect(playlist.items[0].musicVideoId).toBe(videoId);
    });

    it('rejects adding the same video twice with 409', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      const dupe = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      expect(dupe.statusCode).toBe(409);
    });

    it('removes an item', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/playlist/${playlistId}/items/${videoId}`,
        headers: authHeaders(),
      });
      expect(del.statusCode).toBe(204);

      const list = await app.inject({ method: 'GET', url: '/api/v1/playlist', headers: authHeaders() });
      const playlist = list.json().find((p: { id: number }) => p.id === playlistId);
      expect(playlist.items).toHaveLength(0);
    });
  });

  describe('playlist push', () => {
    it('404s when the playlist does not exist', async () => {
      const connector = await createLibraryConnector();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/999999/push/${connector.id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Playlist not found' });
    });

    it('404s when the connector does not exist', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/playlist',
        headers: authHeaders(),
        payload: { name: 'Push Target' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${created.json().id}/push/999999`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Connector not found' });
    });

    it('400s for a connector type that does not support playlist push (subsonic)', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/playlist',
        headers: authHeaders(),
        payload: { name: 'Push Target' },
      });
      const connector = await createLibraryConnector({ type: 'subsonic' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${created.json().id}/push/${connector.id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('does not support playlist push');
    });
  });

  it('DELETE /api/v1/playlist/:id removes the playlist', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist',
      headers: authHeaders(),
      payload: { name: 'To Delete' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/playlist/${created.json().id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });
});

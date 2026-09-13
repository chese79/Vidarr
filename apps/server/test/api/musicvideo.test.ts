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
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('musicvideo routes', () => {
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

  it('POST /api/v1/musicvideo creates a video and derives normalizedTitle', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/musicvideo',
      headers: authHeaders(),
      payload: { artistId, title: "Livin' On A Prayer!" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: "Livin' On A Prayer!", normalizedTitle: 'livin on a prayer', hasFile: false });
  });

  it('POST /api/v1/musicvideo rejects a missing artistId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/musicvideo',
      headers: authHeaders(),
      payload: { title: 'No Artist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/musicvideo filters by artistId and hasFile', async () => {
    await createMusicVideo(artistId, { title: 'A', hasFile: true });
    await createMusicVideo(artistId, { title: 'B', hasFile: false });

    const all = await app.inject({ method: 'GET', url: '/api/v1/musicvideo', headers: authHeaders() });
    expect(all.json()).toHaveLength(2);

    const withFile = await app.inject({
      method: 'GET',
      url: `/api/v1/musicvideo?hasFile=true`,
      headers: authHeaders(),
    });
    expect(withFile.json()).toHaveLength(1);
    expect(withFile.json()[0].title).toBe('A');
  });

  it('PUT /api/v1/musicvideo/:id updates fields and re-derives normalizedTitle when the title changes', async () => {
    const video = await createMusicVideo(artistId, { title: 'Original Title' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/musicvideo/${video.id}`,
      headers: authHeaders(),
      payload: { title: 'New Title', genre: 'Rock' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'New Title', normalizedTitle: 'new title', genre: 'Rock' });
  });

  it('DELETE /api/v1/musicvideo/:id removes the video', async () => {
    const video = await createMusicVideo(artistId, { title: 'To Delete' });

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/musicvideo/${video.id}`, headers: authHeaders() });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/v1/musicvideo', headers: authHeaders() });
    expect(list.json()).toHaveLength(0);
  });

  it('GET /api/v1/musicvideo/:id/search 404s for a nonexistent video before attempting any indexer search', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/musicvideo/999999/search', headers: authHeaders() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Music video not found' });
  });
});

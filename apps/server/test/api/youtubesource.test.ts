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
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('youtubesource routes', () => {
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

  it('POST /api/v1/youtubesource creates a source', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youtubesource',
      headers: authHeaders(),
      payload: { type: 'channel', url: 'https://youtube.com/@artist', artistId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: 'channel', artistId, monitored: true });
  });

  it('POST /api/v1/youtubesource rejects an invalid type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youtubesource',
      headers: authHeaders(),
      payload: { type: 'rss_feed', url: 'https://x', artistId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/youtubesource filters by artistId', async () => {
    const otherRootFolder = await createRootFolder({ path: '/other' });
    const otherQuality = await createQuality({ name: '4k' });
    const otherQualityProfile = await createQualityProfile(otherQuality.id, { name: 'Other Profile' });
    const otherArtist = await createArtist(otherRootFolder.id, otherQualityProfile.id, { name: 'Other' });
    await app.inject({
      method: 'POST',
      url: '/api/v1/youtubesource',
      headers: authHeaders(),
      payload: { type: 'channel', url: 'https://a', artistId },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/youtubesource',
      headers: authHeaders(),
      payload: { type: 'channel', url: 'https://b', artistId: otherArtist.id },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/youtubesource?artistId=${artistId}`,
      headers: authHeaders(),
    });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].url).toBe('https://a');
  });

  it('DELETE /api/v1/youtubesource/:id removes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/youtubesource',
      headers: authHeaders(),
      payload: { type: 'single_video', url: 'https://v', artistId },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/youtubesource/${created.json().id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('history routes', () => {
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

  it('GET /api/v1/history lists events newest-first with musicVideo/artist included', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'History Artist' });
    const video = await createMusicVideo(artist.id, { title: 'History Video' });

    await prisma.history.create({ data: { musicVideoId: video.id, eventType: 'grabbed' } });
    await prisma.history.create({ data: { musicVideoId: video.id, eventType: 'downloadFolderImported' } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/history', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(res.json()[0]).toMatchObject({
      musicVideo: { title: 'History Video', artist: { name: 'History Artist' } },
    });
  });

  it('GET /api/v1/history respects the limit query param', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id);
    const video = await createMusicVideo(artist.id);
    for (let i = 0; i < 5; i++) {
      await prisma.history.create({ data: { musicVideoId: video.id, eventType: 'grabbed' } });
    }

    const res = await app.inject({ method: 'GET', url: '/api/v1/history?limit=2', headers: authHeaders() });
    expect(res.json()).toHaveLength(2);
  });
});

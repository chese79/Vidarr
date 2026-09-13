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

describe('calendar routes', () => {
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

  it('GET /api/v1/calendar returns only monitored videos, with artist included', async () => {
    await createMusicVideo(artistId, { title: 'Monitored' });
    const unmonitored = await createMusicVideo(artistId, { title: 'Unmonitored' });
    // createMusicVideo doesn't expose `monitored` — flip it directly to
    // exercise the filter honestly rather than assuming the default.
    await prisma.musicVideo.update({ where: { id: unmonitored.id }, data: { monitored: false } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/calendar', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({ title: 'Monitored', artist: { name: expect.any(String) } });
  });
});

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

// POST /api/v1/queue/refresh isn't covered — it polls real download clients
// and yt-dlp processes, which this suite doesn't mock.
describe('queue routes', () => {
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

  it('GET /api/v1/queue lists queue items newest-first with musicVideo/artist included', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Queue Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Queued Video' });

    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'abc123', status: 'downloading' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/queue', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({
      status: 'downloading',
      musicVideo: { title: 'Queued Video', artist: { name: 'Queue Artist' } },
    });
  });

  it('filters active work and pages completed and failed history by event time', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    const video = await createMusicVideo(artist.id);
    await prisma.downloadQueueItem.createMany({ data: [
      { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'failed', status: 'failed' },
      { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'active', status: 'queued' },
    ] });
    await prisma.history.createMany({ data: [
      ...[1, 2, 3, 4].map(day => ({ musicVideoId: video.id, eventType: 'downloadFailed', date: new Date(`2026-10-0${day}T10:00:00Z`), data: JSON.stringify({ error: `Error ${day}` }) })),
      { musicVideoId: video.id, eventType: 'downloadFolderImported', date: new Date('2026-10-05T10:00:00Z') },
      { musicVideoId: video.id, eventType: 'grabbed' },
    ] });
    const get = (url: string) => app.inject({ url, headers: authHeaders() });
    expect((await get('/api/v1/queue?activeOnly=true')).json().map((item: { status: string }) => item.status)).toEqual(['queued']);
    expect((await get('/api/v1/queue')).json()).toHaveLength(2);
    const recent = (await get('/api/v1/queue/failures?pageSize=3')).json();
    expect(recent.total).toBe(4);
    expect(recent.items.map((item: { data: string }) => JSON.parse(item.data).error)).toEqual(['Error 4', 'Error 3', 'Error 2']);
    expect((await get('/api/v1/queue/failures?pageSize=3&page=2')).json().items).toHaveLength(1);
    expect((await get('/api/v1/queue/completed')).json()).toMatchObject({ total: 1, items: [{ eventType: 'downloadFolderImported' }] });
    for (const query of ['page=0', 'pageSize=101', 'page=invalid']) {
      expect((await get('/api/v1/queue/failures?' + query)).statusCode).toBe(400);
    }
  });
});

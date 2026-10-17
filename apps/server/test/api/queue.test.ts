import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
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
  createLibraryConnector,
  createLibraryVideo,
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';
import { getDownloadClientProvider } from '../../src/providers/downloadclient/index.js';
vi.mock('../../src/providers/downloadclient/index.js', () => ({ getDownloadClientProvider: vi.fn() }));
vi.mock('../../src/pipeline/downloadDispatcher.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/pipeline/downloadDispatcher.js')>(), wakeDownloadQueue: vi.fn(),
}));

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
    vi.clearAllMocks();
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
  });

  async function unknownSubmission() {
    const root = await createRootFolder();
    const profile = await createQualityProfile((await createQuality()).id);
    const artist = await createArtist(root.id, profile.id);
    const video = await createMusicVideo(artist.id);
    const client = await prisma.downloadClient.create({ data: { name: 'Client', implementation: 'qBittorrent', host: 'localhost', port: 8080 } });
    return prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, downloadClientId: client.id,
      sourceType: 'indexer', sourceRef: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), status: 'submissionUnknown' } });
  }

  it('persists waiting order, keeps new requests at the end and rejects active/stale moves', async () => {
    const active = await unknownSubmission();
    const artistId = (await prisma.musicVideo.findUniqueOrThrow({ where: { id: active.musicVideoId } })).artistId;
    const add = async (sourceRef: string) => prisma.downloadQueueItem.create({ data: {
      musicVideoId: (await createMusicVideo(artistId, { title: sourceRef })).id,
      sourceType: 'youtube', sourceRef, status: 'queued', addedAt: new Date('2026-10-01'),
    } });
    const a = await add('a'); const b = await add('b'); const c = await add('c');
    const move = (id: number, direction: string) => app.inject({ method: 'POST', url: `/api/v1/queue/${id}/move`, headers: authHeaders(), payload: { direction } });
    const order = async () => (await app.inject({ url: '/api/v1/queue?activeOnly=true', headers: authHeaders() })).json()
      .filter((item: { status: string }) => item.status === 'queued').map((item: { id: number }) => item.id);
    expect(await order()).toEqual([a.id, b.id, c.id]);
    expect((await move(c.id, 'top')).statusCode).toBe(200);
    expect(await order()).toEqual([c.id, a.id, b.id]);
    expect((await move(c.id, 'down')).statusCode).toBe(200);
    expect(await order()).toEqual([a.id, c.id, b.id]);
    expect((await move(b.id, 'up')).statusCode).toBe(200);
    expect(await order()).toEqual([a.id, b.id, c.id]);
    await move(a.id, 'bottom');
    expect(await order()).toEqual([b.id, c.id, a.id]);
    const d = await add('d');
    expect(await order()).toEqual([b.id, c.id, a.id, d.id]);
    expect((await move(b.id, 'top')).statusCode).toBe(200);
    expect((await move(active.id, 'top')).statusCode).toBe(409);
    await prisma.downloadQueueItem.update({ where: { id: d.id }, data: { status: 'downloading' } });
    expect((await move(d.id, 'top')).statusCode).toBe(409);
    expect((await move(999999, 'top')).statusCode).toBe(404);
    expect((await move(a.id, 'invalid')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/v1/queue/${a.id}/move`, payload: { direction: 'top' } })).statusCode).toBe(401);
    expect(await prisma.downloadQueueItem.findUnique({ where: { id: active.id } })).toMatchObject({ status: 'submissionUnknown', queuePosition: 0 });
  });

  it('requires operator verification, checks an existing client job and never submits another download', async () => {
    const item = await unknownSubmission();
    const status = vi.fn().mockResolvedValue({ status: 'downloading', progress: .5 });
    const add = vi.fn();
    vi.mocked(getDownloadClientProvider).mockReturnValue({ getStatus: status, addDownload: add, testConnection: vi.fn() });
    const post = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/queue/${item.id}/reconcile`, headers: authHeaders(), payload });
    expect((await post({ action: 'attach', externalRef: 'a'.repeat(40) })).statusCode).toBe(400);
    expect((await post({ action: 'attach', externalRef: 'b'.repeat(40), verified: true })).statusCode).toBe(409);
    expect(status).not.toHaveBeenCalled();
    expect((await post({ action: 'attach', externalRef: 'a'.repeat(40), verified: true })).statusCode).toBe(200);
    expect(await prisma.downloadQueueItem.findUnique({ where: { id: item.id } })).toMatchObject({ status: 'downloading', progress: .5, sourceRef: 'a'.repeat(40) });
    expect(add).not.toHaveBeenCalled();
    expect((await post({ action: 'notSubmitted', verified: true })).statusCode).toBe(409);
  });

  it('moves across batches in a large waiting queue without losing FIFO ties', async () => {
    const root = await createRootFolder();
    const profile = await createQualityProfile((await createQuality()).id);
    const artist = await createArtist(root.id, profile.id);
    await prisma.musicVideo.createMany({ data: Array.from({ length: 600 }, (_, index) => ({
      artistId: artist.id, title: `Video ${index}`, normalizedTitle: `video ${index}`,
    })) });
    const videos = await prisma.musicVideo.findMany({ where: { artistId: artist.id }, orderBy: { id: 'asc' }, select: { id: true } });
    await prisma.downloadQueueItem.createMany({ data: videos.map(video => ({
      musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'test', status: 'queued', addedAt: new Date('2026-10-01'),
    })) });
    const rows = await prisma.downloadQueueItem.findMany({ orderBy: { id: 'asc' }, select: { id: true, addedAt: true } });
    const response = await app.inject({ method: 'POST', url: `/api/v1/queue/${rows[599].id}/move`, headers: authHeaders(), payload: { direction: 'top' } });
    expect(response.statusCode).toBe(200);
    const ordered = (await app.inject({ url: '/api/v1/queue?activeOnly=true', headers: authHeaders() })).json();
    expect(ordered.map((item: { id: number }) => item.id)).toEqual([rows[599].id, ...rows.slice(0, 599).map(row => row.id)]);
    expect(ordered.every((item: { addedAt: string; status: string }) => item.addedAt === rows[0].addedAt.toISOString() && item.status === 'queued')).toBe(true);
  });

  it('retains unknown reservations on client lookup failure and releases only a verified absent submission', async () => {
    const item = await unknownSubmission();
    vi.mocked(getDownloadClientProvider).mockReturnValue({ getStatus: vi.fn().mockRejectedValue(new Error('offline')), addDownload: vi.fn(), testConnection: vi.fn() });
    const post = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/queue/${item.id}/reconcile`, headers: authHeaders(), payload });
    expect((await post({ action: 'attach', externalRef: 'a'.repeat(40), verified: true })).statusCode).toBe(502);
    expect(await prisma.downloadQueueItem.findUnique({ where: { id: item.id } })).toMatchObject({ status: 'submissionUnknown' });
    expect((await post({ action: 'notSubmitted', verified: true })).statusCode).toBe(200);
    expect(await prisma.downloadQueueItem.findUnique({ where: { id: item.id } })).toMatchObject({ status: 'failed' });
    expect(await prisma.history.findFirst()).toMatchObject({ eventType: 'downloadFailed' });
  });

  it('distinguishes a successful import from confirmation in its target server', async () => {
    const root = await createRootFolder();
    const profile = await createQualityProfile((await createQuality()).id);
    const artist = await createArtist(root.id, profile.id);
    const video = await createMusicVideo(artist.id, { hasFile: true });
    await prisma.musicVideo.update({ where: { id: video.id }, data: { awaitingServerScanAt: new Date() } });
    await prisma.history.create({ data: { musicVideoId: video.id, eventType: 'downloadFolderImported' } });
    const first = await app.inject({ url: '/api/v1/queue/completed', headers: authHeaders() });
    expect(first.json().items[0].deliveryStatus).toBe('awaitingServerCataloging');
    await prisma.musicVideo.update({ where: { id: video.id }, data: { awaitingServerScanAt: null } });
    expect((await app.inject({ url: '/api/v1/queue/completed', headers: authHeaders() })).json().items[0].deliveryStatus).toBe('localOnly');
    const target = await createLibraryConnector();
    const other = await createLibraryConnector({ name: 'Other server' });
    await prisma.rootFolder.update({ where: { id: root.id }, data: { targetConnectorId: target.id } });
    await createLibraryVideo(other.id, { musicVideoId: video.id });
    expect((await app.inject({ url: '/api/v1/queue/completed', headers: authHeaders() })).json().items[0].deliveryStatus).toBe('localOnly');
    await createLibraryVideo(target.id, { musicVideoId: video.id });
    expect((await app.inject({ url: '/api/v1/queue/completed', headers: authHeaders() })).json().items[0].deliveryStatus).toBe('readyToPlay');
  });

  it('GET /api/v1/queue lists queue items in dispatch order with musicVideo/artist included', async () => {
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    const artist = await createArtist(rootFolder.id, qualityProfile.id, { name: 'Queue Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Queued Video' });

    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'abc123', status: 'downloading',
        phase: 'merging', stageTimings: JSON.stringify({ extractionMs: 150, transferMs: 2400 }) },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/queue', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({ phase: 'merging', stageTimings: { extractionMs: 150, transferMs: 2400 } });
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

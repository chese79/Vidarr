import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile, createMusicVideo } from '../support/db.js';

describe('live catalog first increment', () => {
  let app: FastifyInstance;
  let artistId: number;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY });
    const artist = await createArtist((await createRootFolder()).id, (await createQualityProfile((await createQuality()).id)).id);
    await prisma.artist.update({ where: { id: artist.id }, data: { musicbrainzArtistId: '00000000-0000-4000-8000-000000000001', musicbrainzMatchStatus: 'confirmed' } });
    artistId = artist.id;
  });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1/live/${url}`, headers: authHeaders(), payload });
  async function performance(overrides = {}) {
    const response = await post('performances', { artistId, title: 'Television set', setting: 'televisionRadio', style: 'acoustic', ...overrides });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('requires authentication for reads and writes', async () => {
    for (const path of ['artists', 'performances', 'recordings']) {
      expect((await app.inject(`/api/v1/live/${path}`)).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: `/api/v1/live/${path}`, payload: {} })).statusCode).toBe(401);
    }
  });

  it('reuses the confirmed artist and preserves repeated song occurrences and unknown dates', async () => {
    const row = await performance({ songs: [{ title: 'Song A' }, { title: 'Song A', section: 'Encore', kind: 'snippet' }] });
    const result = await app.inject({ url: `/api/v1/live/performances/${row.id}`, headers: authHeaders() });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ artistId, performanceDate: null, venue: null, identityStatus: 'independent', recordingState: 'recordingUnknown' });
    expect(result.json().songs.map((song: { position: number; title: string }) => [song.position, song.title])).toEqual([[1, 'Song A'], [2, 'Song A']]);
    expect(await prisma.artist.count()).toBe(1);
    expect(await prisma.musicVideo.count()).toBe(0);
    expect(await prisma.downloadQueueItem.count()).toBe(0);
  });

  it('does not infer identity or merge entries from identical titles or incomplete dates', async () => {
    const one = await performance({ performanceDate: '2025' });
    const two = await performance({ performanceDate: '2025' });
    const three = await performance({ performanceDate: '2026-02-28' });
    expect(new Set([one.id, two.id, three.id]).size).toBe(3);
  });

  it('filters overlapping setting/style views without duplicate identities and paginates before returning rows', async () => {
    const row = await performance();
    await performance({ title: 'Electric studio', setting: 'studioSession', style: 'electric' });
    const response = await app.inject({ url: '/api/v1/live/performances?setting=televisionRadio&style=acoustic&limit=1', headers: authHeaders() });
    expect(response.json()).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect(response.json().items.map((item: { id: number }) => item.id)).toEqual([row.id]);
    const page = await app.inject({ url: '/api/v1/live/performances?offset=1&limit=1', headers: authHeaders() });
    expect(page.json().items).toHaveLength(1);
    expect(page.json().total).toBe(2);
  });

  it.each(['2025-02-29', '2026-13', '2026-00', '2026-04-31', 'not a date'])('rejects invalid date %s atomically', async performanceDate => {
    expect((await post('performances', { artistId, title: 'Invalid', performanceDate, songs: [{ title: 'Orphan' }] })).statusCode).toBe(400);
    expect(await prisma.livePerformance.count()).toBe(0);
    expect(await prisma.liveSongPerformance.count()).toBe(0);
  });

  it('rejects unmatched artists and privileged or premature ownership/monitoring input', async () => {
    await prisma.artist.update({ where: { id: artistId }, data: { musicbrainzMatchStatus: 'suggested' } });
    expect((await post('performances', { artistId, title: 'Unconfirmed' })).statusCode).toBe(409);
    expect((await post('performances', { artistId, title: 'Invalid', monitored: true })).statusCode).toBe(400);
    expect((await post('performances', { artistId, title: 'Invalid', identityStatus: 'confirmed' })).statusCode).toBe(400);
    expect(await prisma.livePerformance.count()).toBe(0);
  });

  it('links one compilation candidate to multiple performances without claiming video eligibility or ownership', async () => {
    const one = await performance(), two = await performance({ title: 'Other date', performanceDate: '2024' });
    const response = await post('recordings', { title: 'Compilation', performanceIds: [one.id, two.id], claimedCoverage: 'entirePerformance', evidenceUrl: 'https://example.com/video' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ reviewStatus: 'pending', claimedCoverage: 'entirePerformance', musicVideoId: null });
    expect(response.json().performances).toHaveLength(2);
    expect(await prisma.recording.count()).toBe(1);
    expect(await prisma.musicVideoFile.count()).toBe(0);
    expect(await prisma.downloadQueueItem.count()).toBe(0);
    const detail = await app.inject({ url: `/api/v1/live/performances/${one.id}`, headers: authHeaders() });
    expect(detail.json()).toMatchObject({ recordingState: 'recordingUnknown', _count: { recordings: 1 } });
  });

  it('rejects a missing linked performance without leaving a partial recording', async () => {
    const row = await performance();
    expect((await post('recordings', { title: 'Broken links', performanceIds: [row.id, row.id + 1000] })).statusCode).toBe(404);
    expect(await prisma.recording.count()).toBe(0);
    expect(await prisma.recordingPerformance.count()).toBe(0);
  });

  it('preserves song identities and rejects stale metadata corrections', async () => {
    const row = await performance({ songs: [{ title: 'Keep this occurrence' }] });
    const song = await prisma.liveSongPerformance.findFirstOrThrow();
    const correct = await app.inject({ method: 'PATCH', url: `/api/v1/live/performances/${row.id}`, headers: authHeaders(),
      payload: { revision: 1, title: 'Corrected', performanceDate: '2024-02-29' } });
    expect(correct.statusCode).toBe(200);
    expect(correct.json()).toMatchObject({ revision: 2, performanceDate: '2024-02-29', identityStatus: 'independent' });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/live/performances/${row.id}`, headers: authHeaders(), payload: { revision: 1, title: 'Stale' } })).statusCode).toBe(409);
    expect(await prisma.liveSongPerformance.findFirstOrThrow()).toEqual(song);
    expect((await prisma.livePerformance.findUniqueOrThrow({ where: { id: row.id } })).title).toBe('Corrected');
  });

  it('rejects credential URLs and attempts to assert validated state', async () => {
    const row = await performance();
    for (const extra of [{ evidenceUrl: 'not a URL' }, { evidenceUrl: 'file:///media/private.mp4' }, { evidenceUrl: 'https://user:secret@example.com/video' }, { reviewStatus: 'approved' }, { hasFile: true }]) {
      expect((await post('recordings', { title: 'Candidate', performanceIds: [row.id], ...extra })).statusCode).toBe(400);
    }
  });

  it('protects live history when the existing artist-delete endpoint is used', async () => {
    await performance();
    await createMusicVideo(artistId);
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/artist/${artistId}`, headers: authHeaders() });
    expect(response.statusCode).toBe(409);
    expect(await prisma.artist.count()).toBe(1);
    expect(await prisma.musicVideo.count()).toBe(1);
    expect(await prisma.livePerformance.count()).toBe(1);
  });

  it('bounds detail candidates while retaining totals and rejects invalid pagination', async () => {
    const row = await performance();
    for (let index = 0; index < 27; index++) await prisma.recording.create({ data: { title: `Camera ${index}`, performances: { create: { performanceId: row.id } } } });
    const response = await app.inject({ url: `/api/v1/live/performances/${row.id}`, headers: authHeaders() });
    expect(response.json().recordings).toHaveLength(25);
    expect(response.json()._count.recordings).toBe(27);
    expect((await app.inject({ url: '/api/v1/live/performances?limit=10000', headers: authHeaders() })).statusCode).toBe(400);
  });
});

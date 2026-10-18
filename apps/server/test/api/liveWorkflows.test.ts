import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile, createMusicVideo } from '../support/db.js';
import { LivePolicy } from '../../src/live/policy.js';
import { noteRecordingFailure } from '../../src/live/acquisitionFailure.js';
import { NotAVideoError } from '../../src/media/inspection.js';
vi.mock('../../src/pipeline/downloadDispatcher.js', async importOriginal => ({ ...await importOriginal<typeof import('../../src/pipeline/downloadDispatcher.js')>(), wakeDownloadQueue: vi.fn(), isDownloadRunnerActive: vi.fn().mockReturnValue(false) }));

let app: FastifyInstance, artistId: number, rootFolderId: number, eventId: number;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY });
  rootFolderId = (await createRootFolder()).id;
  const artist = await createArtist(rootFolderId, (await createQualityProfile((await createQuality()).id)).id);
  artistId = artist.id;
  await prisma.artist.update({ where: { id: artistId }, data: { musicbrainzArtistId: '00000000-0000-4000-8000-000000000001', musicbrainzMatchStatus: 'confirmed' } });
  eventId = (await prisma.livePerformance.create({ data: { artistId, title: 'Event', performanceDate: '2026-10-01', venue: 'Venue', setlistFmId: 'fixture', songs: { create: { position: 1, title: 'Song' } } } })).id;
});
const post = (path: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1/live/${path}`, headers: authHeaders(), payload });
const get = (path: string) => app.inject({ url: `/api/v1/live/${path}`, headers: authHeaders() });
async function candidate(eventIds = [eventId]) {
  return prisma.recording.create({ data: { title: 'Capture', performances: { create: eventIds.map(performanceId => ({ performanceId })) } } });
}

it('masks the setlist key and retains it when other settings change', async () => {
  const policy = LivePolicy.parse({});
  const save = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/v1/live/configuration', headers: authHeaders(), payload });
  expect((await save({ policy, setlistApiKey: 'fixture-private-key' })).statusCode).toBe(200);
  const response = await get('configuration');
  expect(response.json().hasSetlistApiKey).toBe(true); expect(response.body).not.toContain('fixture-private-key');
  expect((await save({ policy: { ...policy, globalDailyBudget: 24 } })).statusCode).toBe(200);
  expect((await prisma.liveConfiguration.findUniqueOrThrow({ where: { id: 1 } })).setlistApiKey).toBe('fixture-private-key');
});
it('requires every compilation event to be reviewed before acquisition', async () => {
  const other = await prisma.livePerformance.create({ data: { artistId, title: 'Other event' } }), row = await candidate([eventId, other.id]);
  const review = (performanceId: number) => post(`recordings/${row.id}/review`, { performanceId, action: 'confirm', videoVerified: true });
  expect((await review(eventId)).json().identityVerified).toBe(false);
  expect((await review(other.id)).json().identityVerified).toBe(true);
  expect(await prisma.recordingPerformance.count({ where: { recordingId: row.id, identityVerified: true } })).toBe(2);
});
it('refuses automatic confirmation with a conflicting date or without actual moving video', async () => {
  const row = await candidate();
  const body = { performanceId: eventId, action: 'automatic', artistMbid: '00000000-0000-4000-8000-000000000001', performanceDate: '2026-10-02', venue: 'Venue', song: 'Song', videoVerified: true };
  expect((await post(`recordings/${row.id}/review`, body)).statusCode).toBe(409);
  expect((await post(`recordings/${row.id}/review`, { ...body, performanceDate: '2026-10-01', videoVerified: false })).statusCode).toBe(409);
  expect((await post(`recordings/${row.id}/review`, { ...body, performanceDate: '2026-10-01' })).statusCode).toBe(200);
});
it('keeps normal music-video identity review in its catalog adapter', async () => {
  const video = await createMusicVideo(artistId), row = await prisma.recording.findFirstOrThrow({ where: { musicVideoId: video.id } });
  expect((await post(`recordings/${row.id}/review`, { performanceId: eventId, action: 'confirm', videoVerified: true })).statusCode).toBe(404);
  expect((await prisma.recording.findUniqueOrThrow({ where: { id: row.id } })).catalogType).toBe('musicVideo');
});
it('preserves overlapping monitoring rules and explicit performance exclusions', async () => {
  const input = { artistId, approved: true, dailyBudget: 2, sources: ['youtube'] };
  const one = (await post('monitoring', input)).json(), two = (await post('monitoring', input)).json();
  expect(one.id).toBeTypeOf('number');
  await app.inject({ method: 'PATCH', url: `/api/v1/live/monitoring/${one.id}`, headers: authHeaders(), payload: { state: 'cancelled' } });
  expect((await prisma.livePerformance.findUniqueOrThrow({ where: { id: eventId } })).monitored).toBe(true);
  await post(`performances/${eventId}/monitoring`, { excluded: true });
  await app.inject({ method: 'PATCH', url: `/api/v1/live/monitoring/${two.id}`, headers: authHeaders(), payload: { state: 'active' } });
  expect((await prisma.livePerformance.findUniqueOrThrow({ where: { id: eventId } })).monitored).toBe(false);
  expect((await post('monitoring/preview', { artistId, from: '2026-02-31' })).statusCode).toBe(400);
});
it('retains viewing history when removing and restoring an unowned performance', async () => {
  const view = await prisma.liveViewing.create({ data: { performanceId: eventId, serverKey: 'server', userId: 'user', watchedSeconds: 99, active: false } });
  expect((await post(`performances/${eventId}/remove`, { confirmed: true })).statusCode).toBe(200);
  expect((await get('performances')).json().items).toHaveLength(0);
  expect((await post(`performances/${eventId}/restore`, {})).statusCode).toBe(200);
  expect((await prisma.liveViewing.findUniqueOrThrow({ where: { id: view.id } })).watchedSeconds).toBe(99);
});
it('protects pins when selecting a preferred recording and scopes preference to event links', async () => {
  const one = await candidate(), two = await candidate();
  await prisma.recording.update({ where: { id: one.id }, data: { pinned: true, preferred: true } });
  await prisma.recordingPerformance.updateMany({ where: { recordingId: one.id }, data: { preferred: true } });
  expect((await app.inject({ method: 'PATCH', url: `/api/v1/live/recordings/${two.id}/preference`, headers: authHeaders(), payload: { preferred: true } })).statusCode).toBe(409);
});
it('retains failed staging, revokes failed content acceptance, and refuses blind external retries', async () => {
  const row = await candidate();
  await prisma.recording.update({ where: { id: row.id }, data: { identityVerified: true, videoVerified: true, reviewStatus: 'accepted' } });
  const source = await prisma.recordingSource.create({ data: { recordingId: row.id, provider: 'youtube', externalId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', accepted: true } });
  const item = await prisma.downloadQueueItem.create({ data: { recordingId: row.id, recordingSourceId: source.id, sourceType: 'indexer', sourceRef: 'job', status: 'failed', downloadedPath: '/retained/pack' } });
  await noteRecordingFailure(item, new NotAVideoError('static fixture'));
  expect((await prisma.recordingSource.findUniqueOrThrow({ where: { id: source.id } })).accepted).toBe(false);
  expect((await prisma.downloadQueueItem.findUniqueOrThrow({ where: { id: item.id } })).downloadedPath).toBe('/retained/pack');
  expect((await app.inject({ method: 'POST', url: `/api/v1/queue/${item.id}/retry`, headers: authHeaders(), payload: { action: 'retryDirect' } })).statusCode).toBe(409);
});

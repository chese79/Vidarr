import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import type { LibraryPlaybackSession } from '../src/providers/library/types.js';
import { pollQualifiedPlayback, resetQualifiedPlaybackContinuity } from '../src/pipeline/qualifiedPlayback.js';
import { buildApp } from '../src/app.js';
import { authHeaders, TEST_API_KEY } from './support/http.js';
import { createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createLibraryConnector, createLibraryVideo, resetDb } from './support/db.js';

const start = Date.parse('2026-10-17T01:00:00Z');
let videoId: number;
let connectorId: number;
let sessions: LibraryPlaybackSession[];
let fetchSessions: ReturnType<typeof vi.spyOn>;
const poll = (seconds: number) => pollQualifiedPlayback(new Date(start + seconds * 1000));
async function at(seconds: number, position = seconds, playing = true) {
  sessions = [{ sessionId: 'session', userId: 'user', externalId: 'item', durationSeconds: 120, positionSeconds: position, playing }];
  await poll(seconds);
}
const count = async () => (await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).qualifiedPlayCount;
beforeEach(async () => {
  await resetDb();
  const artist = await createArtist((await createRootFolder()).id, (await createQualityProfile((await createQuality()).id)).id);
  videoId = (await createMusicVideo(artist.id)).id;
  connectorId = (await createLibraryConnector()).id;
  await prisma.libraryConnector.update({ where: { id: connectorId }, data: { videoLibraryId: 'videos', userId: 'user' } });
  await createLibraryVideo(connectorId, { externalId: 'item', musicVideoId: videoId, playCount: 100 });
  sessions = [];
  fetchSessions = vi.spyOn(jellyfinProvider, 'fetchPlaybackSessions').mockImplementation(async () => sessions);
});
afterEach(() => vi.restoreAllMocks());

it('qualifies at half a short video independently of Last.fm and native server counts, exactly once', async () => {
  await at(0); await at(15); await at(30); await at(45);
  expect(await count()).toBe(0);
  await at(60);
  expect(await count()).toBe(1);
  await Promise.all([poll(60), poll(60), poll(60)]);
  await at(75);
  expect(await count()).toBe(1);
  expect((await prisma.libraryVideo.findFirstOrThrow()).playCount).toBe(100);
  expect(await prisma.lastFmAccount.count()).toBe(0);
  expect(await prisma.qualifiedPlayback.findFirst()).toMatchObject({ listenedSeconds: 75, qualifiedAt: new Date(start + 60_000) });
});
it('qualifies long videos after four minutes of observed watching', async () => {
  sessions = [{ sessionId: 'session', externalId: 'item', durationSeconds: 3600, positionSeconds: 0, playing: true }];
  await poll(0);
  for (let second = 15; second <= 225; second += 15) { sessions[0].positionSeconds = second; await poll(second); }
  expect(await count()).toBe(0);
  sessions[0].positionSeconds = 240; await poll(240);
  expect(await count()).toBe(1);
});
it('does not count pauses, seeks, buffering or missed observation gaps as watching', async () => {
  await at(0); await at(15, 15, false); await at(30, 15, true);
  await at(45, 30); // 15 observed seconds
  await at(60, 100); // seek
  await at(120, 110); // outage gap
  expect(await count()).toBe(0);
  expect((await prisma.qualifiedPlayback.findFirstOrThrow()).listenedSeconds).toBe(15);
});
it('does not infer any already-watched time when observation starts partway through', async () => {
  await at(0, 90); await at(15, 105); await at(30, 120);
  expect(await count()).toBe(0);
});
it('preserves a counted session across a failed server poll without crediting the gap or counting it again', async () => {
  await at(0); await at(15); await at(30); await at(45); await at(60);
  fetchSessions.mockRejectedValueOnce(new Error('Offline'));
  await poll(75);
  await at(90); await at(105);
  expect(await count()).toBe(1);
  expect(await prisma.qualifiedPlayback.count()).toBe(1);
  expect((await prisma.qualifiedPlayback.findFirstOrThrow()).listenedSeconds).toBe(75);
});
it('counts distinct users separately and deduplicates overlapping connectors to the same server/library', async () => {
  const duplicate = await createLibraryConnector({ host: 'http://jellyfin.local:8096' });
  await prisma.libraryConnector.update({ where: { id: duplicate.id }, data: { videoLibraryId: 'videos' } });
  await createLibraryVideo(duplicate.id, { externalId: 'item', musicVideoId: videoId });
  for (let second = 0; second <= 60; second += 15) {
    sessions = ['a', 'b'].map(userId => ({ sessionId: 'session', userId, externalId: 'item', durationSeconds: 120, positionSeconds: second, playing: true }));
    await poll(second);
  }
  expect(await count()).toBe(2);
  expect(await prisma.qualifiedPlayback.count()).toBe(2);
});
it('requires confirmed available catalog identity and never counts pending deletion', async () => {
  await prisma.libraryVideo.updateMany({ data: { matchConfidence: 'probable' } });
  await at(0); await at(15);
  expect(await prisma.qualifiedPlayback.count()).toBe(0);
  await prisma.libraryVideo.updateMany({ data: { matchConfidence: null } });
  await prisma.musicVideo.update({ where: { id: videoId }, data: { deletionState: 'pending' } });
  await at(30);
  expect(await count()).toBe(0);
  expect(await prisma.qualifiedPlayback.count()).toBe(0);
});
it('counts a completed replay as a new viewing rather than repeatedly counting progress notifications', async () => {
  for (const second of [0, 15, 30, 45, 60, 75, 90, 105, 120]) await at(second);
  expect(await count()).toBe(1);
  for (const second of [135, 150, 165, 180, 195]) await at(second, second - 135);
  expect(await count()).toBe(2);
});
it('retains the qualified counter after diagnostic history cleanup and closes disabled sources', async () => {
  await at(0); await at(15); await at(30); await at(45); await at(60);
  await prisma.libraryConnector.update({ where: { id: connectorId }, data: { enabled: false } });
  await poll(75);
  expect((await prisma.qualifiedPlayback.findFirstOrThrow()).active).toBe(false);
  await poll(31 * 86400);
  expect(await prisma.qualifiedPlayback.count()).toBe(0);
  expect(await count()).toBe(1);
});

it('breaks continuity on restart while preserving qualification and viewing identity', async () => {
  await at(0); await at(15); await at(30); await at(45); await at(60);
  await resetQualifiedPlaybackContinuity();
  await at(75);
  expect((await prisma.qualifiedPlayback.findFirstOrThrow()).listenedSeconds).toBe(60);
  expect(await count()).toBe(1);
  expect(await prisma.qualifiedPlayback.count()).toBe(1);
});

it('continues observing a working server when another connector has an invalid endpoint', async () => {
  const invalid = await createLibraryConnector({ host: 'bad endpoint with spaces' });
  await prisma.libraryConnector.update({ where: { id: invalid.id }, data: { videoLibraryId: 'videos' } });
  await at(0); await at(15); await at(30); await at(45); await at(60);
  expect(await count()).toBe(1);
  expect(await prisma.activityLog.count({ where: { source: 'qualified-playback', level: 'warn' } })).toBe(5);
});

it('exposes qualified totals separately from native server totals on every artist catalog view', async () => {
  await at(0); await at(15); await at(30); await at(45); await at(60);
  await prisma.settings.create({ data: { id: 1, apiKey: TEST_API_KEY } });
  const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } });
  await prisma.artist.update({ where: { id: video.artistId }, data: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  const app = await buildApp();
  try {
    const detail = await app.inject({ url: `/api/v1/artist/${video.artistId}`, headers: authHeaders() });
    expect(detail.json().summary).toMatchObject({ qualifiedPlayCount: 1, aggregatePlayCount: 100 });
    const videos = await app.inject({ url: `/api/v1/artist/${video.artistId}/videos`, headers: authHeaders() });
    expect(videos.json()[0]).toMatchObject({ qualifiedPlayCount: 1, effectivePlayCount: 100 });
    const summary = await app.inject({ url: '/api/v1/artist/summary?hideWithoutVideos=false', headers: authHeaders() });
    expect(summary.json().items[0]).toMatchObject({ qualifiedPlayCount: 1, aggregatePlayCount: 100 });
  } finally { await app.close(); }
});

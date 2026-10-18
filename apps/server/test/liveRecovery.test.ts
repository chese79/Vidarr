import { beforeEach, expect, it, vi, afterEach } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from './support/db.js';
import { redundantRecordings } from '../src/live/cleanup.js';
import { reconcileRecordingDelivery } from '../src/live/delivery.js';
import { getLibraryConnectorProvider } from '../src/providers/library/index.js';
import { linkSetlistReference } from '../src/live/setlist.js';
import { pruneOldLogs } from '../src/pipeline/logCleanup.js';
import { observeLivePlayback } from '../src/live/playback.js';
import { scheduleRecordingDeletion } from '../src/live/deletion.js';
vi.mock('../src/providers/library/index.js', () => ({ getLibraryConnectorProvider: vi.fn() }));
let artistId: number, eventId: number, connectorId: number;
beforeEach(async () => {
  await resetDb(); await ensureSettings();
  artistId = (await createArtist((await createRootFolder()).id, (await createQualityProfile((await createQuality()).id)).id)).id;
  await prisma.artist.update({ where: { id: artistId }, data: { musicbrainzArtistId: '00000000-0000-4000-8000-000000000001', musicbrainzMatchStatus: 'confirmed' } });
  eventId = (await prisma.livePerformance.create({ data: { artistId, title: 'Event' } })).id;
  connectorId = (await prisma.libraryConnector.create({ data: { name: 'JF', type: 'jellyfin', host: 'http://fixture', videoLibraryId: 'live' } })).id;
});
afterEach(() => vi.unstubAllGlobals());
async function capture(title: string, score = 5) {
  return prisma.recording.create({ data: { title, identityVerified: true, videoVerified: true, reviewStatus: 'accepted', qualityVerified: true,
    verifiedCoverage: 100, audioScore: score, visualScore: 5, resolution: 720, performances: { create: { performanceId: eventId, identityVerified: true } },
    parts: { create: { position: 1, available: false, durationSeconds: 100 } } }, include: { parts: true } });
}
it('offers redundant cleanup only after delivery and protects pins, unique coverage and unfinished viewing', async () => {
  await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ cleanupRedundantRecordings: true, fullConnectorId: connectorId, fullLibraryId: 'live' }) } });
  const old = await capture('Old', 4), replacement = await capture('Better', 8);
  const song = await prisma.liveSongPerformance.create({ data: { performanceId: eventId, position: 1, title: 'Song' } });
  for (const row of [old, replacement]) await prisma.recordingCoverage.create({ data: { partId: row.parts[0].id, songId: song.id, startSeconds: 0, endSeconds: 100, verified: true, fullSong: true } });
  expect(await redundantRecordings(replacement.id)).toEqual([]);
  await prisma.recordingServerCopy.create({ data: { partId: replacement.parts[0].id, connectorId, libraryId: 'live', externalId: 'replacement', expectedPath: '/server/new.mp4' } });
  expect(await redundantRecordings(replacement.id)).toEqual([{ id: old.id, title: 'Old' }]);
  await prisma.recording.update({ where: { id: old.id }, data: { pinned: true } });
  expect(await redundantRecordings(replacement.id)).toEqual([]);
  await prisma.recording.update({ where: { id: old.id }, data: { pinned: false } });
  const view = await prisma.liveViewing.create({ data: { performanceId: eventId, serverKey: 'server', userId: 'user', partId: old.parts[0].id, active: true } });
  expect(await redundantRecordings(replacement.id)).toEqual([]);
  await prisma.liveViewing.update({ where: { id: view.id }, data: { active: false } });
  const unique = await prisma.liveSongPerformance.create({ data: { performanceId: eventId, position: 2, title: 'Encore' } });
  await prisma.recordingCoverage.create({ data: { partId: old.parts[0].id, songId: unique.id, startSeconds: 0, endSeconds: 50, verified: true, fullSong: true } });
  expect(await redundantRecordings(replacement.id)).toEqual([]);
});
it('preserves confirmed server ownership on an inventory outage and records confirmed absence separately', async () => {
  await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ fullConnectorId: connectorId, fullLibraryId: 'live' }) } });
  const row = await capture('Owned');
  const copy = await prisma.recordingServerCopy.create({ data: { partId: row.parts[0].id, connectorId, libraryId: 'live', externalId: 'owned', expectedPath: '/server/owned.mp4' } });
  vi.mocked(getLibraryConnectorProvider).mockReturnValue({ fetchVideos: vi.fn().mockRejectedValue(new Error('offline')) } as any);
  await reconcileRecordingDelivery(); expect((await prisma.recordingServerCopy.findUniqueOrThrow({ where: { id: copy.id } })).available).toBe(true);
  vi.mocked(getLibraryConnectorProvider).mockReturnValue({ fetchVideos: vi.fn().mockResolvedValue([]), listSections: vi.fn().mockResolvedValue([{ id: 'live', type: 'musicvideos' }]) } as any);
  await reconcileRecordingDelivery(); expect((await prisma.recordingServerCopy.findUniqueOrThrow({ where: { id: copy.id } })).available).toBe(false);
});
it('attaches a later setlist reference without replacing independent performance, song or viewing identities', async () => {
  await prisma.liveConfiguration.create({ data: { setlistApiKey: 'test-only' } });
  const song = await prisma.liveSongPerformance.create({ data: { performanceId: eventId, position: 1, title: 'Kept song' } });
  const view = await prisma.liveViewing.create({ data: { performanceId: eventId, serverKey: 'server', userId: 'user', watchedSeconds: 23 } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'a123', versionId: 'v1', eventDate: '01-10-2026', artist: { mbid: '00000000-0000-4000-8000-000000000001', name: 'Artist' }, venue: { name: 'Venue' }, sets: { set: [] } }), { status: 200 })));
  await linkSetlistReference(eventId, 'a123', 1);
  expect((await prisma.livePerformance.findUniqueOrThrow({ where: { id: eventId } })).setlistFmId).toBe('a123');
  expect(await prisma.liveSongPerformance.findUnique({ where: { id: song.id } })).not.toBeNull();
  expect((await prisma.liveViewing.findUniqueOrThrow({ where: { id: view.id } })).watchedSeconds).toBe(23);
});
it('credits only the intersecting verified artist interval in a compilation', async () => {
  const row = await capture('Compilation');
  const other = await prisma.livePerformance.create({ data: { artistId, title: 'Other set' } });
  await prisma.recordingPerformance.create({ data: { recordingId: row.id, performanceId: other.id, identityVerified: true } });
  const song = await prisma.liveSongPerformance.create({ data: { performanceId: eventId, position: 1, title: 'Song' } });
  await prisma.recordingCoverage.create({ data: { partId: row.parts[0].id, songId: song.id, startSeconds: 10, endSeconds: 20, fullSong: true, verified: true } });
  const now = new Date(), session = { sessionId: 'session', externalId: 'item', userId: 'user', positionSeconds: 5, durationSeconds: 100, playing: true };
  await observeLivePlayback('server', row.parts[0].id, session, now);
  await observeLivePlayback('server', row.parts[0].id, { ...session, positionSeconds: 25 }, new Date(now.getTime() + 20000));
  expect((await prisma.liveViewing.findFirstOrThrow({ where: { performanceId: eventId } })).watchedSeconds).toBe(10);
  expect((await prisma.liveViewing.findFirstOrThrow({ where: { performanceId: other.id } })).watchedSeconds).toBe(0);
});
it('does not expire live history through the general 90-day activity cleanup', async () => {
  const row = await capture('Retained');
  const old = new Date('2020-01-01');
  await prisma.history.createMany({ data: [{ recordingId: row.id, eventType: 'recordingPartImported', date: old }, { eventType: 'liveReferenceLinked', date: old }, { eventType: 'legacyActivity', date: old }] });
  await pruneOldLogs();
  expect((await prisma.history.findMany()).map(item => item.eventType).sort()).toEqual(['liveReferenceLinked', 'recordingPartImported']);
});
it('confirms exact mapped file delivery despite a server filename title and refuses a different file', async () => {
  const row = await capture('Recording title'), root = await prisma.rootFolder.findFirstOrThrow();
  await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ fullConnectorId: connectorId, fullLibraryId: 'live' }) } });
  await prisma.recordingPart.update({ where: { id: row.parts[0].id }, data: { rootFolderId: root.id, available: true, path: `${root.path}/Recording 1/Part 1.mp4` } });
  const videos = [{ externalId: 'wrong', title: 'Recording title', path: '/server/other/Part 1.mp4', durationSeconds: 100 }, { externalId: 'exact', title: 'Part 1', path: '/server/Recording 1/Part 1.mp4', durationSeconds: 100 }];
  vi.mocked(getLibraryConnectorProvider).mockReturnValue({ fetchVideos: vi.fn().mockResolvedValue(videos), listSections: vi.fn().mockResolvedValue([{ id: 'live', type: 'musicvideos' }]) } as any);
  await reconcileRecordingDelivery(); expect((await prisma.recordingServerCopy.findFirstOrThrow()).externalId).toBe('exact');
});
it('refuses deleting an entire compilation under a narrower artist-set or rendition action', async () => {
  const row = await capture('Compilation'), other = await prisma.livePerformance.create({ data: { artistId, title: 'Other set' } });
  await prisma.recordingPerformance.create({ data: { recordingId: row.id, performanceId: other.id } });
  await expect(scheduleRecordingDeletion(row.id, true, 'artistSet', undefined, eventId)).rejects.toThrow('unrelated performances');
  const song = await prisma.liveSongPerformance.create({ data: { performanceId: eventId, position: 1, title: 'Song' } });
  await expect(scheduleRecordingDeletion(row.id, true, 'rendition', song.id)).rejects.toThrow('own verified song clip');
  expect((await prisma.recording.findUniqueOrThrow({ where: { id: row.id } })).deletionState).toBeNull();
});

import { beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo } from './support/db.js';
import { recordingFacts } from '../src/media/recordings.js';

let artistId: number;
beforeEach(async () => { await resetDb(); artistId = (await createArtist((await createRootFolder()).id, (await createQualityProfile((await createQuality()).id)).id)).id; });
it('atomically creates and updates one compatibility recording and physical location without inventing file-less ownership', async () => {
  const video = await createMusicVideo(artistId);
  const recording = await prisma.recording.findFirstOrThrow({ where: { musicVideoId: video.id } });
  const empty = await prisma.recordingPart.findFirstOrThrow({ where: { recordingId: recording.id } });
  expect(empty).toMatchObject({ path: null, sizeBytes: null, available: false, legacyMusicVideoFileId: null });
  expect((await recordingFacts(recording.id)).lifecycle.ownership).toBe('none');
  const file = await prisma.musicVideoFile.create({ data: { musicVideoId: video.id, path: '/media/test-root/kept.mp4', sizeBytes: 100n, originalFilename: 'kept.mp4', playCount: 11 } });
  await prisma.musicVideo.update({ where: { id: video.id }, data: { hasFile: true, qualifiedPlayCount: 7, title: 'Renamed' } });
  const updated = await recordingFacts(recording.id);
  expect(updated.recording.title).toBe('Renamed'); expect(updated.lifecycle.ownership).toBe('local');
  expect(updated.recording.parts[0]).toMatchObject({ id: empty.id, path: file.path, sizeBytes: 100n, legacyMusicVideoFileId: file.id });
  expect(updated.recording.parts[0].legacyMusicVideoFile?.playCount).toBe(11);
  expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } })).qualifiedPlayCount).toBe(7);
  expect(await prisma.livePerformance.count()).toBe(0);
});
it('shares acquisition reservations and provenance while retaining legacy source and queue IDs', async () => {
  const video = await createMusicVideo(artistId), recording = await prisma.recording.findFirstOrThrow({ where: { musicVideoId: video.id } });
  const source = await prisma.acquisitionSource.create({ data: { musicVideoId: video.id, provider: 'youtube', url: 'https://youtube.com/watch?v=abcdefghijk', authority: 'authoritative', confidence: 'confirmed', discoveryOrigin: 'fixture', accepted: true } });
  const queue = await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: source.url, status: 'queued' } });
  const facts = await recordingFacts(recording.id);
  expect(facts.recording.legacySources[0].id).toBe(source.id); expect(facts.recording.queueItems[0]).toMatchObject({ id: queue.id, recordingId: recording.id, musicVideoId: video.id });
  await expect(prisma.downloadQueueItem.create({ data: { recordingId: recording.id, sourceType: 'youtube', sourceRef: source.url, status: 'queued' } })).rejects.toMatchObject({ code: 'P2002' });
  expect(facts.lifecycle.acquisition).toBe('queued');
});
it('does not treat a probable server observation as confirmed ownership', async () => {
  const video = await createMusicVideo(artistId), recording = await prisma.recording.findFirstOrThrow({ where: { musicVideoId: video.id } });
  const connector = await prisma.libraryConnector.create({ data: { name: 'Server', type: 'jellyfin', host: 'http://fixture' } });
  const copy = await prisma.libraryVideo.create({ data: { connectorId: connector.id, externalId: 'item', title: 'Title', normalizedTitle: 'title', artistName: 'Artist', normalizedArtistName: 'artist', musicVideoId: video.id, matchConfidence: 'probable', available: true } });
  expect((await recordingFacts(recording.id)).lifecycle.ownership).toBe('none');
  await prisma.libraryVideo.update({ where: { id: copy.id }, data: { matchConfidence: null } });
  expect((await recordingFacts(recording.id)).lifecycle.ownership).toBe('server');
  expect((await prisma.recordingPart.findFirstOrThrow({ where: { recordingId: recording.id } })).path).toBeNull();
});

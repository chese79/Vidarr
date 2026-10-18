import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, ensureSettings } from './support/db.js';
import { enqueueRecording, importRecordingDownload } from '../src/live/acquisition.js';
import { assertHasMotion } from '../src/media/inspection.js';
import { classifyExistingVideo, returnToMusicVideos } from '../src/live/reclassification.js';
import { scheduleRecordingDeletion, processRecordingDeletions } from '../src/live/deletion.js';
import { addRecordingToPlaylist } from '../src/live/playlists.js';
import { reorderPlaylistItemIds } from '../src/pipeline/playlistEdit.js';

vi.mock('../src/media/inspection.js', () => ({ assertHasMotion: vi.fn().mockResolvedValue(undefined), assertHasVideoStream: vi.fn().mockResolvedValue(undefined),
  assertMovingVideoSamples: vi.fn().mockResolvedValue(undefined), assertFileIntegrity: vi.fn().mockResolvedValue(undefined), getVideoProbe: vi.fn().mockResolvedValue({ duration: 120, width: 1280, height: 720 }) }));
vi.mock('../src/pipeline/downloadDispatcher.js', () => ({ wakeDownloadQueue: vi.fn() }));
let folder: string, rootFolderId: number, artistId: number, performanceId: number;
beforeEach(async () => {
  vi.mocked(assertHasMotion).mockReset().mockResolvedValue(undefined);
  await resetDb(); await ensureSettings(); await prisma.settings.update({ where: { id: 1 }, data: { minFreeSpaceMb: 0 } });
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-live-assets-'));
  rootFolderId = (await createRootFolder({ path: folder })).id;
  artistId = (await createArtist(rootFolderId, (await createQualityProfile((await createQuality()).id)).id)).id;
  await prisma.artist.update({ where: { id: artistId }, data: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: '00000000-0000-4000-8000-000000000001' } });
  performanceId = (await prisma.livePerformance.create({ data: { artistId, title: 'Live show' } })).id;
});
afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });
async function recording() {
  return prisma.recording.create({ data: { title: 'Recording', reviewStatus: 'accepted', identityVerified: true, videoVerified: true, performances: { create: { performanceId, identityVerified: true } } } });
}
it('reserves a real recording target in the existing queue and refuses uncertain content and unknown pack approval', async () => {
  const row = await recording();
  await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ fullRootFolderId: rootFolderId }) } });
  const source = await prisma.recordingSource.create({ data: { recordingId: row.id, provider: 'youtube', externalId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', accepted: true } });
  const queued = await enqueueRecording(row.id, source.id);
  expect(queued).toMatchObject({ musicVideoId: null, recordingId: row.id, status: 'queued', validationCategory: 'liveUnknown', validationPolicy: null });
  await expect(enqueueRecording(row.id, source.id)).rejects.toThrow('active');
  expect(await prisma.musicVideo.count()).toBe(0);
});
it('recovers a partially imported pack without replacing its first file or changing its frozen validation choices', async () => {
  const row = await recording(), incoming = path.join(folder, 'incoming'); await fs.mkdir(incoming);
  await fs.writeFile(path.join(incoming, 'one.mp4'), 'one'); await fs.writeFile(path.join(incoming, 'two.mp4'), 'two');
  const item = await prisma.downloadQueueItem.create({ data: { recordingId: row.id, rootFolderId, sourceType: 'indexer', sourceRef: 'external-job', status: 'importing', downloadedPath: incoming,
    validationCategory: 'liveFull', selectedFiles: JSON.stringify({ selected: ['one.mp4', 'two.mp4'] }) } });
  vi.mocked(assertHasMotion).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Interrupted inspection'));
  await expect(importRecordingDownload(item)).rejects.toThrow('Interrupted');
  const first = await prisma.recordingPart.findFirstOrThrow();
  expect(await fs.readFile(first.path, 'utf8')).toBe('one');
  await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ full: { file: false, motion: false } }) } });
  const resumed = await prisma.downloadQueueItem.findUniqueOrThrow({ where: { id: item.id } });
  expect(JSON.parse(resumed.validationPolicy!)).toEqual({ file: true, motion: true });
  await importRecordingDownload(resumed);
  const parts = await prisma.recordingPart.findMany({ orderBy: { position: 'asc' } });
  expect(parts).toHaveLength(2); expect(parts[0].id).toBe(first.id);
  expect(parts.map(part => part.position)).toEqual([1, 2]);
  expect(vi.mocked(assertHasMotion).mock.calls.at(-1)?.[2]).toBeUndefined();
  expect(await fs.readFile(path.join(incoming, 'one.mp4'), 'utf8')).toBe('one');
});
it('reclassifies and reverses an existing video without moving its file, changing counts or replacing playlist IDs', async () => {
  const video = await createMusicVideo(artistId, { title: 'Misclassified', hasFile: true });
  await prisma.musicVideo.update({ where: { id: video.id }, data: { isLiveConcert: true, qualifiedPlayCount: 7 } });
  const filename = path.join(folder, 'kept.mp4'); await fs.writeFile(filename, 'retained');
  const file = await prisma.musicVideoFile.create({ data: { musicVideoId: video.id, path: filename, sizeBytes: 8n, originalFilename: 'kept.mp4', playCount: 11 } });
  const playlist = await prisma.playlist.create({ data: { name: 'Kept', items: { create: { musicVideoId: video.id, sortOrder: 9 } } }, include: { items: true } });
  const row = await classifyExistingVideo(video.id, performanceId, true);
  expect((await prisma.recordingPart.findFirstOrThrow()).legacyMusicVideoFileId).toBe(file.id);
  expect(await prisma.musicVideoFile.findUnique({ where: { id: file.id } })).toEqual(file);
  expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } })).qualifiedPlayCount).toBe(7);
  expect((await prisma.playlistItem.findFirstOrThrow()).id).toBe(playlist.items[0].id);
  expect(await prisma.downloadQueueItem.count()).toBe(0);
  await expect(returnToMusicVideos(row.id, false)).rejects.toThrow('eligibility');
  await returnToMusicVideos(row.id, true);
  expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } })).isLiveConcert).toBe(false);
  expect(await fs.readFile(filename, 'utf8')).toBe('retained');
  await prisma.musicVideo.update({ where: { id: video.id }, data: { isLiveConcert: true } });
  expect((await classifyExistingVideo(video.id, performanceId, true)).id).toBe(row.id);
});
it('delays deletion, retains performance/viewing history and only deletes the selected recording bundle', async () => {
  const row = await recording(), filename = path.join(folder, 'remove.mp4'), unrelated = path.join(folder, 'keep.mp4');
  await fs.writeFile(filename, 'delete fixture'); await fs.writeFile(unrelated, 'keep fixture');
  await prisma.recordingPart.create({ data: { recordingId: row.id, position: 1, rootFolderId, path: filename, sizeBytes: 14n } });
  await prisma.liveViewing.create({ data: { performanceId, serverKey: 'server', userId: 'viewer', watchedSeconds: 42 } });
  await expect(scheduleRecordingDeletion(row.id, false)).rejects.toThrow('Confirm');
  await scheduleRecordingDeletion(row.id, true);
  await processRecordingDeletions(new Date()); expect(await fs.readFile(filename, 'utf8')).toBe('delete fixture');
  await processRecordingDeletions(new Date(Date.now() + 6 * 60000));
  await expect(fs.stat(filename)).rejects.toThrow(); expect(await fs.readFile(unrelated, 'utf8')).toBe('keep fixture');
  expect(await prisma.livePerformance.count()).toBe(1); expect((await prisma.liveViewing.findFirstOrThrow()).watchedSeconds).toBe(42);
  expect((await prisma.recording.findUniqueOrThrow({ where: { id: row.id } })).deletionState).toBe('deleted');
});
it('keeps mixed playlist order and requires an explicit whole-recording fallback for song segments', async () => {
  const row = await recording();
  const connector = await prisma.libraryConnector.create({ data: { name: 'JF', type: 'jellyfin', host: 'http://fixture', videoLibraryId: 'live', enabled: true } });
  const part = await prisma.recordingPart.create({ data: { recordingId: row.id, rootFolderId, position: 1, path: path.join(folder, 'video.mp4'), sizeBytes: 1n,
    serverCopies: { create: { connectorId: connector.id, libraryId: 'live', externalId: 'video', expectedPath: '/server/video.mp4' } } } });
  const song = await prisma.liveSongPerformance.create({ data: { performanceId, title: 'Song', position: 1 } });
  await prisma.recordingCoverage.create({ data: { partId: part.id, songId: song.id, startSeconds: 0, endSeconds: 60, fullSong: true, verified: true } });
  const video = await createMusicVideo(artistId), playlist = await prisma.playlist.create({ data: { name: 'Mixed', targetConnectorId: connector.id } });
  const old = await prisma.playlistItem.create({ data: { playlistId: playlist.id, musicVideoId: video.id, sortOrder: 0 } });
  await expect(addRecordingToPlaylist(playlist.id, part.id, song.id)).rejects.toThrow('bounded');
  const live = await addRecordingToPlaylist(playlist.id, part.id, song.id, true);
  await reorderPlaylistItemIds(playlist.id, [live.id, old.id]);
  expect((await prisma.playlistItem.findMany({ orderBy: { sortOrder: 'asc' } })).map(item => item.id)).toEqual([live.id, old.id]);
  await expect(reorderPlaylistItemIds(playlist.id, [old.id])).rejects.toThrow('changed');
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/db/client.js';
import { deleteMusicVideo, recoverInterruptedVideoDeletions, processPendingVideoDeletions } from '../src/pipeline/deleteVideo.js';
import { isScanExcluded, loadScanExclusions } from '../src/pipeline/deletedVideoScans.js';
import { plexProvider } from '../src/providers/library/plex.js';
import { queueDirectVideo } from '../src/pipeline/grab.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createMusicVideoFile, createLibraryConnector, createLibraryVideo } from './support/db.js';

let directory: string;
let artistId: number;
async function runDue(id: number) {
  const row = await prisma.musicVideo.findUniqueOrThrow({ where: { id } });
  await processPendingVideoDeletions(row.deletionNextAttemptAt!);
}
beforeEach(async () => {
  await resetDb(); await ensureSettings();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-delete-'));
  artistId = (await createArtist((await createRootFolder({ path: directory })).id, (await createQualityProfile((await createQuality()).id)).id)).id;
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

it('deletes the owned bundle and catalog while preserving unrelated files and recording identities', async () => {
  const video = await createMusicVideo(artistId, { title: 'Song', youtubeVideoId: 'youtube-id', hasFile: true });
  const file = path.join(directory, 'Song.mp4');
  for (const name of ['Song.mp4', 'Song.nfo', 'Song-thumb.jpg', 'Song.en.srt', 'Song 2.mp4']) await fs.writeFile(path.join(directory, name), 'fixture');
  await createMusicVideoFile(video.id, { path: file });
  await expect(deleteMusicVideo(video.id, false)).rejects.toThrow('confirmation');
  await deleteMusicVideo(video.id, true);
  expect(await fs.readFile(file, 'utf8')).toBe('fixture');
  await processPendingVideoDeletions();
  expect(await prisma.musicVideo.count()).toBe(1);
  await runDue(video.id);
  expect(await fs.readdir(directory)).toEqual(['Song 2.mp4']);
  expect(await prisma.musicVideo.count()).toBe(0);
  expect(await prisma.deletedVideoRecord.count()).toBe(1);
  expect(isScanExcluded(await loadScanExclusions(), artistId, { youtubeVideoId: 'youtube-id' })).toBe(false);
  await prisma.settings.update({ where: { id: 1 }, data: { excludeDeletedVideosFromScans: true } });
  const exclusions = await loadScanExclusions();
  expect(isScanExcluded(exclusions, artistId, { youtubeVideoId: 'youtube-id' })).toBe(true);
  expect(isScanExcluded(exclusions, artistId + 1, { youtubeVideoId: 'youtube-id' })).toBe(false);
  expect(isScanExcluded(exclusions, artistId, { youtubeVideoId: 'another-version', title: 'Song' })).toBe(false);
});

it('allows deletion without confirmation only when warning is disabled', async () => {
  await prisma.settings.update({ where: { id: 1 }, data: { warnBeforeDelete: false } });
  const video = await createMusicVideo(artistId);
  await deleteMusicVideo(video.id, false);
  await runDue(video.id);
  expect(await prisma.musicVideo.count()).toBe(0);
});

it('retains a locked file and retries forty minutes later', async () => {
  const video = await createMusicVideo(artistId);
  const file = path.join(directory, 'locked.mp4');
  await fs.writeFile(file, 'fixture');
  await createMusicVideoFile(video.id, { path: file });
  await deleteMusicVideo(video.id, true);
  const unlink = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('File is in use'), { code: 'EBUSY' }));
  await runDue(video.id);
  expect(await fs.readFile(file, 'utf8')).toBe('fixture');
  expect(await prisma.musicVideo.findUnique({ where: { id: video.id } })).toMatchObject({ deletionState: 'failed', deletionAttempts: 1 });
  unlink.mockRestore();
  await runDue(video.id);
  expect(await prisma.musicVideo.count()).toBe(0);
});

it('blocks every active download state without changing the catalog', async () => {
  const video = await createMusicVideo(artistId);
  const queue = await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'fixture', status: 'queued' } });
  for (const status of ['queued', 'downloading', 'importing', 'submissionUnknown']) {
    await prisma.downloadQueueItem.update({ where: { id: queue.id }, data: { status } });
    await expect(deleteMusicVideo(video.id, true)).rejects.toThrow('Queue');
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } })).deletionState).toBeNull();
  }
});

it('refuses paths outside configured roots and symlinks', async () => {
  const video = await createMusicVideo(artistId);
  const file = await createMusicVideoFile(video.id, { path: path.join(os.tmpdir(), 'outside.mp4') });
  await expect(deleteMusicVideo(video.id, true)).rejects.toThrow('outside');
  const link = path.join(directory, 'link.mp4');
  await fs.writeFile(path.join(directory, 'real.mp4'), 'fixture');
  await fs.symlink(path.join(directory, 'real.mp4'), link);
  await prisma.musicVideoFile.update({ where: { id: file.id }, data: { path: link } });
  await expect(deleteMusicVideo(video.id, true)).rejects.toThrow('symlink');
  expect(await fs.readFile(path.join(directory, 'real.mp4'), 'utf8')).toBe('fixture');
});

it('preflights all copies and retains a retryable catalog entry on a server failure', async () => {
  const video = await createMusicVideo(artistId);
  const connector = await createLibraryConnector({ type: 'plex' });
  const match = await createLibraryVideo(connector.id, { musicVideoId: video.id });
  await prisma.libraryVideo.update({ where: { id: match.id }, data: { path: '/server/song.mp4' } });
  vi.spyOn(plexProvider, 'verifyVideoDeletion').mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValue(undefined);
  const remove = vi.spyOn(plexProvider, 'deleteVideo').mockResolvedValue(undefined);
  vi.spyOn(plexProvider, 'isVideoInUse').mockResolvedValue(false);
  await deleteMusicVideo(video.id, true);
  const scheduled = await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } });
  await runDue(video.id);
  expect(remove).not.toHaveBeenCalled();
  expect(await prisma.musicVideo.findUnique({ where: { id: video.id } })).toMatchObject({ deletionState: 'failed', ignored: true, monitored: false });
  const failed = await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } });
  expect(failed.deletionNextAttemptAt!.getTime() - scheduled.deletionNextAttemptAt!.getTime()).toBe(40 * 60_000);
  await runDue(video.id);
  expect(remove).toHaveBeenCalledOnce();
  expect(await prisma.libraryVideo.count()).toBe(0);
  expect(await prisma.musicVideo.count()).toBe(0);
});

it('recovers interrupted deletion without performing destructive work', async () => {
  const video = await createMusicVideo(artistId);
  await prisma.musicVideo.update({ where: { id: video.id }, data: { deletionState: 'running' } });
  await recoverInterruptedVideoDeletions();
  expect(await prisma.musicVideo.findUnique({ where: { id: video.id } })).toMatchObject({ deletionState: 'failed' });
});

it('waits while a matched copy is playing or paused and completes at the later scheduled attempt', async () => {
  const video = await createMusicVideo(artistId);
  const connector = await createLibraryConnector({ type: 'plex' });
  const match = await createLibraryVideo(connector.id, { musicVideoId: video.id });
  await prisma.libraryVideo.update({ where: { id: match.id }, data: { path: '/server/song.mp4' } });
  vi.spyOn(plexProvider, 'verifyVideoDeletion').mockResolvedValue(undefined);
  const remove = vi.spyOn(plexProvider, 'deleteVideo').mockResolvedValue(undefined);
  vi.spyOn(plexProvider, 'isVideoInUse').mockResolvedValueOnce(true).mockResolvedValue(false);
  await deleteMusicVideo(video.id, true);
  const scheduled = await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } });
  expect(scheduled.deletionNextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(290_000);
  await runDue(video.id);
  expect(remove).not.toHaveBeenCalled();
  const deferred = await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } });
  expect(deferred.deletionError).toContain('playback session');
  await processPendingVideoDeletions(new Date(deferred.deletionNextAttemptAt!.getTime() - 1));
  expect(remove).not.toHaveBeenCalled();
  await runDue(video.id);
  expect(remove).toHaveBeenCalledOnce();
  expect(await prisma.musicVideo.count()).toBe(0);
});

it('refuses new acquisition for a deletion intent even if a stale edit clears ignored', async () => {
  const video = await createMusicVideo(artistId, { youtubeVideoId: 'fixture-id' });
  await prisma.musicVideo.update({ where: { id: video.id }, data: { deletionState: 'failed', ignored: false } });
  await expect(queueDirectVideo(video.id)).rejects.toThrow('deletion is pending');
  expect(await prisma.downloadQueueItem.count()).toBe(0);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/db/client.js';
import { importDownloadedFile } from '../src/pipeline/import.js';
import { createArtist, createMusicVideo, createMusicVideoFile, createQuality, createQualityProfile, createRootFolder, ensureSettings, resetDb } from './support/db.js';

describe('quality upgrade import safety', () => {
  let directory: string;
  let oldPath: string;
  let sourcePath: string;
  let videoId: number;

  beforeEach(async () => {
    await resetDb();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-import-test-'));
    const rootPath = path.join(directory, 'library');
    await fs.mkdir(rootPath);
    oldPath = path.join(rootPath, 'old.mp4');
    sourcePath = path.join(directory, 'upgrade.mp4');
    await fs.writeFile(oldPath, 'old video');
    await fs.writeFile(sourcePath, 'new video');
    await ensureSettings();
    await prisma.settings.update({ where: { id: 1 }, data: {
      namingFormat: '{Artist Name}/{Video Title} [{Quality}]', transferMode: 'copy', minFreeSpaceMb: 0,
    } });
    const root = await createRootFolder({ path: rootPath });
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    const video = await createMusicVideo(artist.id, { title: 'Song', hasFile: true });
    videoId = video.id;
    await createMusicVideoFile(videoId, { path: oldPath });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('retains the old file and database path if recording the replacement fails', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(importDownloadedFile(videoId, sourcePath, '1080p')).rejects.toThrow('database unavailable');
    await expect(fs.readFile(oldPath, 'utf-8')).resolves.toBe('old video');
    expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { musicVideoId: videoId } })).path).toBe(oldPath);
  });

  it('moves video and its metadata together, preserves supplied NFO, and leaves unrelated files alone', async () => {
    await prisma.musicVideo.update({ where: { id: videoId }, data: { releaseYear: 1996 } });
    await prisma.settings.update({ where: { id: 1 }, data: { transferMode: 'move' } });
    await fs.writeFile(sourcePath.replace('.mp4', '.nfo'), '<musicvideo><title>Wrong title</title><year>2009</year><plot>Keep this plot</plot></musicvideo>');
    await fs.writeFile(sourcePath.replace('.mp4', '-thumb.jpg'), 'artwork');
    await fs.writeFile(sourcePath.replace('.mp4', '.en.srt'), 'subtitles');
    await fs.writeFile(path.join(directory, 'other.nfo'), 'unrelated');
    await fs.writeFile(path.join(directory, 'upgrade-other.nfo'), 'another video');
    const result = await importDownloadedFile(videoId, sourcePath, '1080p');
    const base = result.path.replace('.mp4', '');
    await expect(fs.readFile(`${base}.nfo`, 'utf8')).resolves.toContain('<title>Song</title>');
    await expect(fs.readFile(`${base}.nfo`, 'utf8')).resolves.toContain('<plot>Keep this plot</plot>');
    await expect(fs.readFile(`${base}.nfo`, 'utf8')).resolves.toContain('<year>1996</year>');
    await expect(fs.readFile(`${base}-thumb.jpg`, 'utf8')).resolves.toBe('artwork');
    await expect(fs.readFile(`${base}.en.srt`, 'utf8')).resolves.toBe('subtitles');
    await expect(fs.access(sourcePath)).rejects.toThrow();
    await expect(fs.access(sourcePath.replace('.mp4', '.nfo'))).rejects.toThrow();
    await expect(fs.readFile(path.join(directory, 'other.nfo'), 'utf8')).resolves.toBe('unrelated');
    await expect(fs.readFile(path.join(directory, 'upgrade-other.nfo'), 'utf8')).resolves.toBe('another video');
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).awaitingServerScanAt).not.toBeNull();
  });

  it('does not overwrite another video or an untracked file at the computed destination', async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { namingFormat: 'collision' } });
    const collision = path.join(path.dirname(oldPath), 'collision.mp4');
    await fs.writeFile(collision, 'untracked video');
    await expect(importDownloadedFile(videoId, sourcePath, '1080p')).rejects.toThrow('Destination already exists');
    const other = await createMusicVideo((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).artistId, { title: 'Other' });
    await createMusicVideoFile(other.id, { path: collision });
    await expect(importDownloadedFile(videoId, sourcePath, '1080p')).rejects.toThrow('another video');
    await expect(fs.readFile(collision, 'utf8')).resolves.toBe('untracked video');
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('new video');
  });

  it('restores metadata and retains a move source if database recording fails', async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { namingFormat: 'old', transferMode: 'move' } });
    await fs.writeFile(oldPath.replace('.mp4', '.nfo'), 'previous metadata');
    await fs.writeFile(sourcePath.replace('.mp4', '.nfo'), '<musicvideo><plot>new metadata</plot></musicvideo>');
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(importDownloadedFile(videoId, sourcePath, '1080p')).rejects.toThrow('database unavailable');
    await expect(fs.readFile(oldPath.replace('.mp4', '.nfo'), 'utf8')).resolves.toBe('previous metadata');
    await expect(fs.readFile(sourcePath.replace('.mp4', '.nfo'), 'utf8')).resolves.toBe('<musicvideo><plot>new metadata</plot></musicvideo>');
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('new video');
  });

  it.each(['copy', 'hardlink', 'move'])('restores a same-path %s upgrade when database recording fails', async (mode) => {
    await prisma.settings.update({ where: { id: 1 }, data: { namingFormat: 'old', transferMode: mode } });
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('database unavailable'));

    await expect(importDownloadedFile(videoId, sourcePath, '1080p')).rejects.toThrow('database unavailable');
    await expect(fs.readFile(oldPath, 'utf-8')).resolves.toBe('old video');
    await expect(fs.readFile(sourcePath, 'utf-8')).resolves.toBe('new video');
    expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { musicVideoId: videoId } })).path).toBe(oldPath);
    expect((await fs.readdir(path.dirname(oldPath))).filter(name => name.includes('.vidarr-'))).toEqual([]);
  });

  it('restores a same-path upgrade when sidecar writing fails', async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { namingFormat: 'old' } });
    await fs.mkdir(path.join(path.dirname(oldPath), 'old.nfo'));
    await expect(importDownloadedFile(videoId, sourcePath, '1080p')).rejects.toThrow();
    await expect(fs.readFile(oldPath, 'utf-8')).resolves.toBe('old video');
  });

  it('commits a same-path upgrade and removes its backup after successful recording', async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { namingFormat: 'old' } });
    await importDownloadedFile(videoId, sourcePath, '1080p');
    await expect(fs.readFile(oldPath, 'utf-8')).resolves.toBe('new video');
    expect((await fs.readdir(path.dirname(oldPath))).filter(name => name.includes('.vidarr-'))).toEqual([]);
  });

  it('removes the old file only after recording a successful replacement', async () => {
    const result = await importDownloadedFile(videoId, sourcePath, '1080p');
    await expect(fs.access(oldPath)).rejects.toThrow();
    await expect(fs.readFile(result.path, 'utf-8')).resolves.toBe('new video');
    expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { musicVideoId: videoId } })).path).toBe(result.path);
  });

  it('retains an old file outside the configured root', async () => {
    const outsidePath = path.join(directory, 'outside.mp4');
    await fs.rename(oldPath, outsidePath);
    await prisma.musicVideoFile.update({ where: { musicVideoId: videoId }, data: { path: outsidePath } });
    await importDownloadedFile(videoId, sourcePath, '1080p');
    await expect(fs.readFile(outsidePath, 'utf-8')).resolves.toBe('old video');
  });

  it('rejects a Windows host root before writing into the Linux working directory', async () => {
    if (process.platform === 'win32') return;
    await prisma.rootFolder.updateMany({ data: { path: 'D:\\media\\music-videos' } });

    await expect(importDownloadedFile(videoId, sourcePath, '1080p'))
      .rejects.toThrow('mounted container path');
    await expect(fs.readFile(sourcePath, 'utf-8')).resolves.toBe('new video');
    await expect(fs.readFile(oldPath, 'utf-8')).resolves.toBe('old video');
    expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { musicVideoId: videoId } })).path).toBe(oldPath);
  });
});

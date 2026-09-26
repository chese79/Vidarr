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
});

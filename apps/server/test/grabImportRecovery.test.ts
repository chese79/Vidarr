import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/db/client.js';
import { grabYoutubeVideo } from '../src/pipeline/grab.js';
import { downloadDirectVideo } from '../src/providers/youtube/ytdlp.js';
import { createArtist, createMusicVideo, createQuality, createQualityProfile, createRootFolder, resetDb } from './support/db.js';

vi.mock('../src/providers/youtube/ytdlp.js', () => ({ downloadDirectVideo: vi.fn() }));
vi.mock('../src/pipeline/validateVideoFile.js', () => ({ assertIsRealMusicVideo: vi.fn() }));
vi.mock('../src/pipeline/import.js', () => ({ importDownloadedFile: vi.fn().mockRejectedValue(new Error('recording failed')) }));

let directory: string;
beforeEach(async () => {
  await resetDb();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-grab-recovery-'));
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it('retains a downloaded video and metadata when import fails, and records its recovery path', async () => {
  const source = path.join(directory, 'download.mp4');
  await fs.writeFile(source, 'video');
  await fs.writeFile(path.join(directory, 'download.nfo'), 'metadata');
  vi.mocked(downloadDirectVideo).mockResolvedValue(source);
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  const artist = await createArtist(root.id, profile.id);
  const video = await createMusicVideo(artist.id, { youtubeVideoId: 'download' });
  await expect(grabYoutubeVideo(video.id)).rejects.toThrow('recording failed');
  await expect(fs.readFile(source, 'utf8')).resolves.toBe('video');
  await expect(fs.readFile(path.join(directory, 'download.nfo'), 'utf8')).resolves.toBe('metadata');
  expect((await prisma.downloadQueueItem.findFirstOrThrow()).status).toBe('failed');
  expect(JSON.parse((await prisma.history.findFirstOrThrow()).data)).toMatchObject({ downloadedPath: source });
});

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db/client.js';
import { downloadVideo } from '../providers/youtube/ytdlp.js';
import { importDownloadedFile, type ImportResult } from './import.js';

const STAGING_DIR = process.env.STAGING_DIR ?? path.join(os.tmpdir(), 'vidarr-staging');

export async function grabYoutubeVideo(musicVideoId: number): Promise<ImportResult> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({ where: { id: musicVideoId } });
  if (!musicVideo.youtubeVideoId) {
    throw new Error('This music video has no linked YouTube source.');
  }

  const queueItem = await prisma.downloadQueueItem.create({
    data: {
      musicVideoId,
      sourceType: 'youtube',
      sourceRef: musicVideo.youtubeVideoId,
      status: 'downloading',
    },
  });

  try {
    await fs.mkdir(STAGING_DIR, { recursive: true });
    const downloadedPath = await downloadVideo(musicVideo.youtubeVideoId, STAGING_DIR);
    const result = await importDownloadedFile(musicVideoId, downloadedPath, 'YouTube');
    await fs.unlink(downloadedPath).catch(() => {});
    await prisma.downloadQueueItem.delete({ where: { id: queueItem.id } });
    return result;
  } catch (err) {
    await prisma.downloadQueueItem.update({
      where: { id: queueItem.id },
      data: { status: 'failed' },
    });
    await prisma.history.create({
      data: {
        musicVideoId,
        eventType: 'downloadFailed',
        data: JSON.stringify({ error: (err as Error).message }),
      },
    });
    throw err;
  }
}

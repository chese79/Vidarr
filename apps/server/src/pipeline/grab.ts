import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db/client.js';
import { downloadVideo } from '../providers/youtube/ytdlp.js';
import { getDownloadClientProvider } from '../providers/downloadclient/index.js';
import { importDownloadedFile, type ImportResult } from './import.js';
import { locateVideoFile } from './locateVideoFile.js';

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

// Sends a grabbed release to a download client and records the queue item —
// the actual import happens later, once refreshQueue() sees it complete
// (there's no scheduler yet, so that's a manual "Refresh Queue" trigger for
// now; see docs/plan.md's M3 note on this being a deliberate v1 simplification).
export async function grabFromIndexer(
  musicVideoId: number,
  downloadClientId: number,
  downloadUrl: string,
  quality: string,
): Promise<void> {
  const client = await prisma.downloadClient.findUniqueOrThrow({ where: { id: downloadClientId } });
  const category = client.category || 'vidarr';
  const provider = getDownloadClientProvider(client.implementation);

  const handle = await provider.addDownload(client, downloadUrl, category);

  await prisma.downloadQueueItem.create({
    data: {
      musicVideoId,
      sourceType: 'indexer',
      sourceRef: handle.externalRef,
      downloadClientId,
      status: 'downloading',
      quality,
    },
  });
  await prisma.history.create({
    data: {
      musicVideoId,
      eventType: 'grabbed',
      data: JSON.stringify({ quality, downloadClient: client.name }),
    },
  });
}

export async function refreshQueue(): Promise<{ completed: number; failed: number; pending: number }> {
  const items = await prisma.downloadQueueItem.findMany({
    where: { sourceType: 'indexer', status: 'downloading' },
    include: { downloadClient: true },
  });

  let completed = 0;
  let failed = 0;
  let pending = 0;

  for (const item of items) {
    if (!item.downloadClient) continue;
    const provider = getDownloadClientProvider(item.downloadClient.implementation);
    const category = item.downloadClient.category || 'vidarr';

    try {
      const status = await provider.getStatus(item.downloadClient, item.sourceRef, category);
      if (status.status === 'downloading') {
        await prisma.downloadQueueItem.update({
          where: { id: item.id },
          data: { progress: status.progress },
        });
        pending++;
      } else if (status.status === 'completed' && status.contentPath) {
        const videoPath = await locateVideoFile(status.contentPath);
        await importDownloadedFile(item.musicVideoId, videoPath, item.quality ?? 'SD');
        await prisma.downloadQueueItem.delete({ where: { id: item.id } });
        completed++;
      } else {
        await prisma.downloadQueueItem.update({
          where: { id: item.id },
          data: { status: 'failed' },
        });
        await prisma.history.create({
          data: {
            musicVideoId: item.musicVideoId,
            eventType: 'downloadFailed',
            data: JSON.stringify({ error: status.error }),
          },
        });
        failed++;
      }
    } catch (err) {
      await prisma.activityLog.create({
        data: { level: 'error', source: 'queue', message: (err as Error).message },
      });
    }
  }

  return { completed, failed, pending };
}

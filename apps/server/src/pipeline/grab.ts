import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db/client.js';
import { downloadVideo } from '../providers/youtube/ytdlp.js';
import { getDownloadClientProvider } from '../providers/downloadclient/index.js';
import { importDownloadedFile, type ImportResult } from './import.js';
import { locateVideoFile } from './locateVideoFile.js';
import { assertIsRealMusicVideo } from './validateVideoFile.js';

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

  let downloadedPath: string | undefined;
  try {
    await fs.mkdir(STAGING_DIR, { recursive: true });
    let lastProgressWrite = 0;
    downloadedPath = await downloadVideo(musicVideo.youtubeVideoId, STAGING_DIR, undefined, (fraction) => {
      const now = Date.now();
      if (now - lastProgressWrite < 1000) return; // throttle DB writes
      lastProgressWrite = now;
      prisma.downloadQueueItem
        .update({ where: { id: queueItem.id }, data: { progress: fraction } })
        .catch(() => {});
    });
    await assertIsRealMusicVideo(downloadedPath);
    const result = await importDownloadedFile(musicVideoId, downloadedPath, 'YouTube');
    await fs.unlink(downloadedPath).catch(() => {});
    await prisma.downloadQueueItem.delete({ where: { id: queueItem.id } });
    return result;
  } catch (err) {
    if (downloadedPath) await fs.unlink(downloadedPath).catch(() => {});
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
// the actual import happens later, once refreshQueue() sees it complete (the
// scheduled "Download Queue Monitor" job calls this periodically).
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
        continue;
      }

      if (status.status === 'completed' && status.contentPath) {
        try {
          const videoPath = await locateVideoFile(status.contentPath);
          await assertIsRealMusicVideo(videoPath);
          await importDownloadedFile(item.musicVideoId, videoPath, item.quality ?? 'SD');
          await prisma.downloadQueueItem.delete({ where: { id: item.id } });
          completed++;
          continue;
        } catch (err) {
          status.error = (err as Error).message; // fall through to the shared failure handling below
        }
      }

      await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { status: 'failed' } });
      await prisma.history.create({
        data: {
          musicVideoId: item.musicVideoId,
          eventType: 'downloadFailed',
          data: JSON.stringify({ error: status.error }),
        },
      });
      failed++;
    } catch (err) {
      // getStatus() itself failed (e.g. transient network error) — leave the
      // item as-is so the next monitor pass retries, rather than failing it.
      await prisma.activityLog.create({
        data: { level: 'error', source: 'queue', message: (err as Error).message },
      });
    }
  }

  return { completed, failed, pending };
}

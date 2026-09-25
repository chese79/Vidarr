import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Prisma, type DownloadQueueItem } from '@prisma/client';
import { prisma, logActivity } from '../db/client.js';
import { downloadDirectVideo } from '../providers/youtube/ytdlp.js';
import { getDownloadClientProvider } from '../providers/downloadclient/index.js';
import { importDownloadedFile, type ImportResult } from './import.js';
import { locateVideoFile } from './locateVideoFile.js';
import { assertIsRealMusicVideo } from './validateVideoFile.js';
import { hasActiveDownload } from './videoStatus.js';

const STAGING_DIR = process.env.STAGING_DIR ?? path.join(os.tmpdir(), 'vidarr-staging');

export async function grabYoutubeVideo(musicVideoId: number): Promise<ImportResult> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({
    where: { id: musicVideoId },
    include: {
      acquisitionSources: {
        where: { accepted: true },
        orderBy: [{ authority: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const directSource = musicVideo.acquisitionSources.find((source) => /^https?:\/\//i.test(source.url));
  const source = directSource ?? (musicVideo.youtubeVideoId
    ? {
      provider: 'youtube',
      externalId: musicVideo.youtubeVideoId,
      url: `https://www.youtube.com/watch?v=${musicVideo.youtubeVideoId}`,
    }
    : null);
  if (!source) throw new Error('This music video has no accepted direct acquisition source.');
  // Guards manual grabs too (musicvideo.ts's /grab and /grab-release call
  // these functions directly, bypassing autoSearchAndGrab's own check) — no
  // call site should ever be able to create a second live queue row for the
  // same video.
  if (await hasActiveDownload(musicVideoId)) {
    throw new Error('This video already has an active download.');
  }

  // The hasActiveDownload() check above is a fast-path that avoids the DB
  // round-trip in the common case, not the authoritative guard: two
  // concurrent calls for the same musicVideoId can each pass it before
  // either insert lands. The partial unique index added in migration
  // 20260921045136_grab_queue_dedup_unique_index, later extended to include
  // submissionUnknown, is what actually prevents a second
  // live row, so a P2002 here means we lost that race — surface the exact
  // same error the fast-path check above throws, so no caller can tell
  // which guard caught it.
  let queueItem: DownloadQueueItem;
  try {
    queueItem = await prisma.downloadQueueItem.create({
      data: {
        musicVideoId,
        sourceType: source.provider,
        sourceRef: source.url,
        status: 'downloading',
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('This video already has an active download.');
    }
    throw err;
  }

  let downloadedPath: string | undefined;
  try {
    await fs.mkdir(STAGING_DIR, { recursive: true });
    let lastProgressWrite = 0;
    downloadedPath = await downloadDirectVideo(source.url, STAGING_DIR, undefined, (fraction) => {
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
  // Checked before contacting the download client at all — no point handing
  // it a redundant job we're about to reject.
  if (await hasActiveDownload(musicVideoId)) {
    throw new Error('This video already has an active download.');
  }

  const client = await prisma.downloadClient.findUniqueOrThrow({ where: { id: downloadClientId } });
  const category = client.category || 'vidarr';
  const provider = getDownloadClientProvider(client.implementation);

  // The queue row is created BEFORE contacting the download client, not
  // after: if anything throws between the two, an addDownload() call that
  // actually reached the external client used to leave zero local record of
  // it (an orphaned download). sourceRef starts as the downloadUrl itself —
  // the only identifier available before the download client hands back its
  // own handle — and is corrected to the real externalRef below once
  // addDownload() returns. This create() is also the authoritative dedup
  // guard (see grabYoutubeVideo's identical comment on the partial unique
  // index); hasActiveDownload() above is only the fast-path.
  let queueItem: DownloadQueueItem;
  try {
    queueItem = await prisma.downloadQueueItem.create({
      data: {
        musicVideoId,
        sourceType: 'indexer',
        sourceRef: downloadUrl,
        downloadClientId,
        status: 'downloading',
        quality,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('This video already has an active download.');
    }
    throw err;
  }

  let handle;
  try {
    handle = await provider.addDownload(client, downloadUrl, category);
  } catch (err) {
    // A transport error is ambiguous: the client may have accepted the job
    // before the response was lost. Retain the reservation so an automatic
    // retry cannot submit a duplicate. The queue exposes this explicit state
    // for manual reconciliation instead of pretending the request certainly
    // failed or deleting the only local evidence of it.
    await prisma.downloadQueueItem.update({
      where: { id: queueItem.id },
      data: { status: 'submissionUnknown' },
    });
    await prisma.history.create({
      data: {
        musicVideoId,
        eventType: 'downloadSubmissionUnknown',
        data: JSON.stringify({ error: (err as Error).message, downloadClient: client.name }),
      },
    });
    throw err;
  }

  await prisma.downloadQueueItem.update({
    where: { id: queueItem.id },
    data: { sourceRef: handle.externalRef },
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
      await logActivity('warn', 'download-queue', err);
    }
  }

  return { completed, failed, pending };
}

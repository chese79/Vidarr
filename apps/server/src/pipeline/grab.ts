import { noteRecordingFailure } from '../live/acquisitionFailure.js';
import { assertRecordingEligible, importRecordingDownload } from '../live/acquisition.js';
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
import { preferredDirectSource } from './directSourcePriority.js';
import { drainDownloadQueue, registerDownloadRunner, registerProcessingRunner, wakeDownloadQueue } from './downloadDispatcher.js';
import { STAGING_DIR } from './downloadTuning.js';
import { readDownloadTimings, type DownloadTimings } from './downloadTimings.js';
import { validationCategoryForSource, validationOptions } from './validationPolicy.js';

const waiting = new Map<number, { resolve: (result: ImportResult | undefined) => void; reject: (err: unknown) => void }>();

// Serialize the queue claim with deletion intent so a stale preflight cannot
// enqueue work after Delete has claimed the catalog entry.
async function createQueueItem(data: Prisma.DownloadQueueItemUncheckedCreateInput): Promise<DownloadQueueItem> {
  return prisma.$transaction(async tx => {
    const video = await tx.musicVideo.findUniqueOrThrow({ where: { id: data.musicVideoId! }, select: { deletionState: true, ignored: true, catalogKind: true } });
    if (video.catalogKind === 'liveClassified') throw new Error('Use the Live recording acquisition workflow for this classified video.');
    if (video.deletionState) throw new Error('Video deletion is pending; finish Delete before downloading.');
    if (video.ignored) throw new Error('Video is ignored; unignore it before downloading.');
    return tx.downloadQueueItem.create({ data });
  });
}

function waitForItem(id: number): Promise<ImportResult | undefined> {
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

export async function grabYoutubeVideo(musicVideoId: number): Promise<ImportResult> {
  const item = await enqueueDirectDownload(musicVideoId);
  const result = waitForItem(item.id);
  wakeDownloadQueue();
  return (await result)!;
}

export async function queueDirectVideo(musicVideoId: number): Promise<{ queueId: number }> {
  const item = await enqueueDirectDownload(musicVideoId);
  wakeDownloadQueue();
  return { queueId: item.id };
}

async function enqueueDirectDownload(musicVideoId: number): Promise<DownloadQueueItem> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({
    where: { id: musicVideoId },
    include: {
      acquisitionSources: {
        where: { accepted: true },
      },
    },
  });
  const directSource = preferredDirectSource(musicVideo.acquisitionSources);
  if (musicVideo.ignored) throw new Error('Video is ignored; unignore it before downloading.');
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
    queueItem = await createQueueItem({
        musicVideoId,
        sourceType: source.provider,
        sourceRef: source.url,
        status: 'queued',
        validationCategory: validationCategoryForSource(directSource),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('This video already has an active download.');
    }
    throw err;
  }

  return queueItem;
}

async function runDirectDownload(queueItem: DownloadQueueItem): Promise<void> {
  const musicVideoId = queueItem.musicVideoId;
  let downloadedPath: string | undefined;
  let progressWrites = Promise.resolve();
  let writingProgress = false;
  let pendingProgress: number | undefined;
  let stageWrites = Promise.resolve();
  let timings: DownloadTimings = {};
  try {
    const directory = queueItem.stagingDirectory ?? (queueItem.phase === 'legacy' ? STAGING_DIR : path.join(STAGING_DIR, `queue-${queueItem.id}`));
    await fs.mkdir(directory, { recursive: true });
    await prisma.downloadQueueItem.update({ where: { id: queueItem.id }, data: { stagingDirectory: directory } });
    let lastProgressWrite = 0;
    downloadedPath = await downloadDirectVideo(queueItem.sourceRef, directory, undefined, (fraction) => {
      const now = Date.now();
      if (now - lastProgressWrite < 1000) return; // throttle DB writes
      lastProgressWrite = now;
      pendingProgress = fraction;
      if (writingProgress) return;
      writingProgress = true;
      progressWrites = (async () => {
        while (pendingProgress !== undefined) {
          const progress = pendingProgress;
          pendingProgress = undefined;
          try { await prisma.downloadQueueItem.updateMany({ where: { id: queueItem.id, status: 'downloading' }, data: { progress } }); }
          catch (error) { await logActivity('warn', 'download-progress', error).catch(() => {}); }
        }
      })().finally(() => { writingProgress = false; });
    }, event => {
      if (event.timings) timings = event.timings;
      if (event.phase) stageWrites = stageWrites.then(async () => {
        await prisma.downloadQueueItem.updateMany({ where: { id: queueItem.id, status: 'downloading' }, data: { phase: event.phase } });
      }).catch(error => logActivity('warn', 'download-progress', error).catch(() => {}));
    });
    await progressWrites;
    await stageWrites;
    await prisma.downloadQueueItem.update({ where: { id: queueItem.id }, data: {
      progress: 1, status: 'importing', phase: 'waitingValidation', downloadedPath,
      downloadedAt: new Date(), stageTimings: JSON.stringify(timings),
    } });
    wakeDownloadQueue();
  } catch (err) {
    await progressWrites;
    await stageWrites;
    // A failed import retains the downloaded bundle for recovery; never
    // discard its only copy merely because recording or metadata failed.
    await prisma.downloadQueueItem.update({
      where: { id: queueItem.id },
      data: { status: 'failed', error: (err as Error).message, stageTimings: JSON.stringify(timings) },
    });
    await prisma.history.create({
      data: {
        musicVideoId, recordingId: queueItem.recordingId,
        eventType: 'downloadFailed',
        data: JSON.stringify({ queueId: queueItem.id, error: (err as Error).message, downloadedPath, timings }),
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
  waitForSubmission = true,
): Promise<void> {
  const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id: musicVideoId } });
  if (video.ignored) throw new Error('Video is ignored; unignore it before downloading.');
  // Checked before contacting the download client at all — no point handing
  // it a redundant job we're about to reject.
  if (await hasActiveDownload(musicVideoId)) {
    throw new Error('This video already has an active download.');
  }

  await prisma.downloadClient.findUniqueOrThrow({ where: { id: downloadClientId } });

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
    queueItem = await createQueueItem({
        musicVideoId,
        sourceType: 'indexer',
        validationCategory: 'additional',
        sourceRef: downloadUrl,
        downloadClientId,
        status: 'queued',
        quality,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('This video already has an active download.');
    }
    throw err;
  }

  const submitted = waitForSubmission ? waitForItem(queueItem.id) : null;
  wakeDownloadQueue();
  if (submitted) await submitted;
}

async function submitIndexerDownload(queueItem: DownloadQueueItem): Promise<void> {
  const musicVideoId = queueItem.musicVideoId;
  const client = await prisma.downloadClient.findUniqueOrThrow({ where: { id: queueItem.downloadClientId! } });
  const provider = getDownloadClientProvider(client.implementation);
  const category = client.category || 'vidarr';
  let handle;
  // Persist uncertainty before making the external call, including if Vidarr
  // restarts after the client accepted it but before its handle was saved.
  await prisma.downloadQueueItem.update({ where: { id: queueItem.id }, data: { status: 'submissionUnknown' } });
  try {
    handle = await provider.addDownload(client, queueItem.sourceRef, category);
  } catch (err) {
    // A transport error is ambiguous: the client may have accepted the job
    // before the response was lost. Retain the reservation so an automatic
    // retry cannot submit a duplicate. The queue exposes this explicit state
    // for manual reconciliation instead of pretending the request certainly
    // failed or deleting the only local evidence of it.
    await prisma.downloadQueueItem.update({
      where: { id: queueItem.id },
      data: { status: 'submissionUnknown', error: (err as Error).message },
    });
    await prisma.history.create({
      data: {
        musicVideoId, recordingId: queueItem.recordingId,
        eventType: 'downloadSubmissionUnknown',
        data: JSON.stringify({ error: (err as Error).message, downloadClient: client.name }),
      },
    });
    throw err;
  }

  await prisma.downloadQueueItem.update({
    where: { id: queueItem.id },
    data: { sourceRef: handle.externalRef, status: 'downloading' },
  });
  await prisma.history.create({
    data: {
      musicVideoId, recordingId: queueItem.recordingId,
      eventType: 'grabbed',
      data: JSON.stringify({ quality: queueItem.quality, downloadClient: client.name }),
    },
  });
}

registerDownloadRunner(async item => {
  try {
    if (item.musicVideoId === null && item.recordingId) await assertRecordingEligible(item.recordingId);
    else { const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id: item.musicVideoId! } });
      if (video.ignored) throw new Error('Video is ignored; unignore it before downloading.'); }
    if (item.sourceType === 'indexer') {
      await submitIndexerDownload(item);
      waiting.get(item.id)?.resolve(undefined);
      waiting.delete(item.id);
    } else await runDirectDownload(item);
  } catch (err) {
    const current = await prisma.downloadQueueItem.findUnique({ where: { id: item.id } });
    if (current && !['failed', 'submissionUnknown'].includes(current.status)) {
      await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { status: 'failed', error: (err as Error).message } });
      await prisma.history.create({ data: { musicVideoId: item.musicVideoId, recordingId: item.recordingId, eventType: 'downloadFailed',
        data: JSON.stringify({ error: (err as Error).message }) } });
    }
    await noteRecordingFailure(item, err).catch(error => logActivity('warn', 'live-recovery', error));
    waiting.get(item.id)?.reject(err);
    waiting.delete(item.id);
    throw err;
  }
});

registerProcessingRunner(async item => {
  const timings = readDownloadTimings(item.stageTimings);
  const start = Date.now();
  timings.processingWaitMs = Math.max(0, start - (item.downloadedAt?.getTime() ?? start));
  let imported: ImportResult | undefined;
  let importStarted: number | undefined;
  try {
    if (!item.downloadedPath) throw new Error('Downloaded file path is missing; retained for recovery.');
    if (item.musicVideoId !== null) {
      const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id: item.musicVideoId! } });
      if (video.ignored) throw new Error('Video is ignored; unignore it before importing.');
      const validation = await validationOptions(item.validationCategory);
      await assertIsRealMusicVideo(item.downloadedPath, validation);
    }
    timings.validationMs = Date.now() - start;
    await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { phase: 'importing', stageTimings: JSON.stringify(timings) } });
    const importing = Date.now();
    importStarted = importing;
    const result = item.musicVideoId === null ? await importRecordingDownload(item) : await importDownloadedFile(item.musicVideoId!, item.downloadedPath, item.quality ?? (item.sourceType === 'indexer' ? 'SD' : 'YouTube'), item.id);
    imported = result;
    timings.importMs = Date.now() - importing;
    timings.totalMs = Date.now() - item.addedAt.getTime();
    // Diagnostics must never convert a committed import into a failed download.
    try {
      const event = await prisma.history.findFirst({ where: { musicVideoId: item.musicVideoId, recordingId: item.recordingId, eventType: 'downloadFolderImported', date: { gte: item.addedAt } }, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
      if (event) await prisma.history.update({ where: { id: event.id }, data: { data: JSON.stringify({ ...JSON.parse(event.data ?? '{}'), timings }) } });
      await logActivity('info', 'download-timings', JSON.stringify({ queueId: item.id, musicVideoId: item.musicVideoId, recordingId: item.recordingId, timings }));
    } catch (error) { await logActivity('warn', 'download-timings', error).catch(() => {}); }
    if (item.sourceType !== 'indexer') {
      await fs.unlink(item.downloadedPath).catch(() => {});
      if (path.dirname(item.downloadedPath) === path.join(STAGING_DIR, `queue-${item.id}`)) await fs.rmdir(path.dirname(item.downloadedPath)).catch(() => {});
    }
    await prisma.downloadQueueItem.delete({ where: { id: item.id } });
    waiting.get(item.id)?.resolve(result);
  } catch (error) {
    if (imported) {
      await prisma.downloadQueueItem.updateMany({ where: { id: item.id }, data: { phase: 'completed', stageTimings: JSON.stringify(timings) } }).catch(() => {});
      await logActivity('warn', 'download-cleanup', error).catch(() => {});
      waiting.get(item.id)?.resolve(imported);
      return;
    }
    if (importStarted === undefined) timings.validationMs = Date.now() - start;
    else timings.importMs = Date.now() - importStarted;
    timings.totalMs = Date.now() - item.addedAt.getTime();
    await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { status: 'failed', error: (error as Error).message, stageTimings: JSON.stringify(timings) } });
    await prisma.history.create({ data: { musicVideoId: item.musicVideoId, recordingId: item.recordingId, eventType: 'downloadFailed', data: JSON.stringify({ queueId: item.id, error: (error as Error).message, downloadedPath: item.downloadedPath, timings }) } });
    await noteRecordingFailure(item, error).catch(diagnostic => logActivity('warn', 'live-recovery', diagnostic));
    waiting.get(item.id)?.reject(error);
    throw error;
  } finally { waiting.delete(item.id); }
});

// Only Vidarr-owned transfers are restarted. External clients keep their handles;
// an uncertain submission is never sent again automatically.
export async function resumeDownloadQueue(): Promise<void> {
  const interrupted = await prisma.downloadQueueItem.findMany({ where: { status: { in: ['downloading', 'importing'] } }, include: { musicVideo: { include: { file: true } } } });
  for (const item of interrupted) {
    if (item.status === 'importing') {
      // The import transaction records its queue ID. A crash after commit must
      // not redownload a moved source or import the same bundle a second time.
      const imported = await prisma.history.findFirst({ where: { musicVideoId: item.musicVideoId, recordingId: item.recordingId,
        eventType: 'downloadFolderImported', date: { gte: item.addedAt } }, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
      let committed = false;
      try {
        const data = JSON.parse(imported?.data ?? '{}');
        committed = Boolean(item.musicVideo?.file && data.path === item.musicVideo.file.path
          && (data.queueId === item.id || item.phase === 'legacy')
          && await fs.stat(item.musicVideo.file.path).then(stat => stat.isFile(), () => false));
      } catch { /* Invalid old diagnostic data is not proof of a committed import. */ }
      if (item.musicVideoId === null && item.recordingId && dataCommitted(imported?.data, item.id)) committed = true;
      if (committed) { await prisma.downloadQueueItem.delete({ where: { id: item.id } }); continue; }
      if (item.downloadedPath && await fs.stat(item.downloadedPath).then(stat => stat.isFile() || Boolean(item.musicVideoId === null && item.recordingId && stat.isDirectory()), () => false)) {
        await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { phase: 'waitingValidation', processingStartedAt: null } });
        continue;
      }
    }
    if (item.sourceType === 'indexer') {
      if (item.status === 'importing') await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { status: 'downloading', phase: null, downloadedPath: null } });
    } else await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { status: 'queued', progress: 0,
      phase: item.phase === 'legacy' ? 'legacy' : null, downloadedPath: null } });
  }
  await drainDownloadQueue();
}

let refreshing: ReturnType<typeof refreshQueueOnce> | null = null;
export function refreshQueue(): ReturnType<typeof refreshQueueOnce> {
  if (refreshing) return refreshing;
  refreshing = refreshQueueOnce().finally(() => { refreshing = null; });
  return refreshing;
}

async function refreshQueueOnce() {
  const items = await prisma.downloadQueueItem.findMany({
    where: { sourceType: 'indexer', status: 'downloading' },
    include: { downloadClient: true },
  });

  let completed = 0;
  let failed = 0;
  let pending = 0;
  let staged = 0;

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
          const videoPath = item.musicVideoId === null && item.recordingId ? status.contentPath : await locateVideoFile(status.contentPath);
          await prisma.downloadQueueItem.update({ where: { id: item.id }, data: {
            status: 'importing', progress: 1, phase: 'waitingValidation', downloadedPath: videoPath, downloadedAt: new Date(),
          } });
          staged++;
          continue;
        } catch (err) {
          status.error = (err as Error).message; // fall through to the shared failure handling below
        }
      }

      await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { status: 'failed', error: status.error ?? 'Download failed' } });
      await prisma.history.create({
        data: {
          musicVideoId: item.musicVideoId, recordingId: item.recordingId,
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

  await drainDownloadQueue();
  const groups = await prisma.downloadQueueItem.groupBy({ by: ['status'], _count: true });
  const count = (status: string) => groups.find(group => group.status === status)?._count ?? 0;
  const queueCounts = { queued: count('queued'), downloading: count('downloading'), importing: count('importing'),
    submissionUnknown: count('submissionUnknown'), failedRecords: count('failed') };
  pending = queueCounts.queued + queueCounts.downloading + queueCounts.importing + queueCounts.submissionUnknown;
  return { completed, failed, pending, staged, queueCounts };
}

function dataCommitted(value: string | null | undefined, queueId: number): boolean { try { return JSON.parse(value ?? '{}').queueId === queueId; } catch { return false; } }

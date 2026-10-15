import type { DownloadQueueItem } from '@prisma/client';
import { prisma, logActivity } from '../db/client.js';
import fs from 'node:fs/promises';
import { STAGING_DIR, pipelineCapacity } from './downloadTuning.js';

let runner: (item: DownloadQueueItem) => Promise<void>;
let processor: (item: DownloadQueueItem) => Promise<void>;
let processing = false;
let draining: Promise<void> | null = null;
let requested = false;
const runningItems = new Set<number>();
export function isDownloadRunnerActive(id: number): boolean { return runningItems.has(id); }

export function registerDownloadRunner(callback: typeof runner) { runner = callback; }
export function registerProcessingRunner(callback: typeof processor) { processor = callback; }

async function startProcessing(): Promise<void> {
  if (!processor || processing) return;
  processing = true;
  let claimed: number | undefined;
  try {
    // Recover a committed import whose final queue cleanup failed. Its queue ID
    // is recorded in the same transaction as ownership and completion history.
    const cleanup = await prisma.downloadQueueItem.findMany({ where: { status: 'importing', phase: { in: ['importing', 'completed'] } }, select: { id: true, musicVideoId: true, addedAt: true } });
    for (const item of cleanup) {
      const event = await prisma.history.findFirst({ where: { musicVideoId: item.musicVideoId, eventType: 'downloadFolderImported', date: { gte: item.addedAt } }, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
      try {
        if (JSON.parse(event?.data ?? '{}').queueId === item.id) await prisma.downloadQueueItem.deleteMany({ where: { id: item.id, status: 'importing' } });
      } catch (error) { await logActivity('warn', 'download-cleanup', error).catch(() => {}); }
    }
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      UPDATE DownloadQueueItem SET phase = 'validating'
      WHERE id = (SELECT id FROM DownloadQueueItem WHERE status = 'importing' AND phase = 'waitingValidation'
        AND downloadedPath IS NOT NULL ORDER BY downloadedAt, id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM DownloadQueueItem WHERE status = 'importing' AND phase IN ('validating', 'importing'))
      RETURNING id`;
    if (!rows.length) { processing = false; return; }
    claimed = Number(rows[0].id);
    const item = await prisma.downloadQueueItem.update({ where: { id: claimed }, data: { processingStartedAt: new Date() } });
    void processor(item).catch(error => logActivity('warn', 'download-processing', error).catch(() => {}))
      .finally(() => { processing = false; wakeDownloadQueue(); });
  } catch (error) {
    if (claimed !== undefined) await prisma.downloadQueueItem.updateMany({ where: { id: claimed, status: 'importing', phase: 'validating' }, data: { phase: 'waitingValidation' } }).catch(() => {});
    processing = false; throw error;
  }
}

async function claimNextDownload(): Promise<DownloadQueueItem | null> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { maxConcurrentDownloads: true, minFreeSpaceMb: true } });
  const capacity = pipelineCapacity(settings?.maxConcurrentDownloads ?? 3);
  await fs.mkdir(STAGING_DIR, { recursive: true });
  const space = await fs.statfs(STAGING_DIR, { bigint: true });
  if (space.bavail * space.bsize < BigInt(settings?.minFreeSpaceMb ?? 512) * 1024n * 1024n) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      // Enforce capacity and FIFO in one statement, avoiding interactive leases.
      const rows = await prisma.$queryRaw<Array<{ id: number }>>`
        UPDATE DownloadQueueItem SET status = 'downloading', progress = 0,
          phase = CASE WHEN phase = 'legacy' THEN 'legacy' ELSE 'extracting' END
        WHERE id = (SELECT id FROM DownloadQueueItem WHERE status = 'queued' ORDER BY addedAt, id LIMIT 1)
          AND (SELECT COUNT(*) FROM DownloadQueueItem WHERE status IN ('downloading', 'submissionUnknown'))
            < COALESCE((SELECT maxConcurrentDownloads FROM Settings WHERE id = 1), 3)
          AND (SELECT COUNT(*) FROM DownloadQueueItem WHERE status IN ('downloading', 'importing', 'submissionUnknown')) < ${capacity}
        RETURNING id`;
      return rows.length ? prisma.downloadQueueItem.findUnique({ where: { id: Number(rows[0].id) } }) : null;
    } catch (error) {
      if (attempt >= 2 || !/SQLITE_BUSY|database is locked|Operations timed out|P1008|P2034/i.test(String(error))) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

// Transfer slots and processing reservations are separate. Queued jobs survive restarts;
// external submissions with an unknown outcome retain their slot to avoid duplicates.
export function drainDownloadQueue(): Promise<void> {
  requested = true;
  if (draining) return draining;
  draining = (async () => {
    do {
      requested = false;
      await startProcessing();
      while (runner) {
        const item = await claimNextDownload();
        if (!item) break;
        runningItems.add(item.id);
        void runner(item).catch(err => logActivity('warn', 'download-queue', err).catch(() => {}))
          .finally(() => { runningItems.delete(item.id); wakeDownloadQueue(); });
      }
    } while (requested);
  })().finally(() => { draining = null; });
  return draining;
}

export function wakeDownloadQueue() {
  void drainDownloadQueue().catch(err => logActivity('warn', 'download-queue', err).catch(() => {}));
}

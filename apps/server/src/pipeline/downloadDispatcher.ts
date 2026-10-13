import type { DownloadQueueItem } from '@prisma/client';
import { prisma, logActivity } from '../db/client.js';

let runner: (item: DownloadQueueItem) => Promise<void>;
let draining: Promise<void> | null = null;
let requested = false;
const runningItems = new Set<number>();
export function isDownloadRunnerActive(id: number): boolean { return runningItems.has(id); }

export function registerDownloadRunner(callback: typeof runner) { runner = callback; }

async function claimNextDownload(): Promise<DownloadQueueItem | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      // Enforce capacity and FIFO in one statement, avoiding interactive leases.
      const rows = await prisma.$queryRaw<Array<{ id: number }>>`
        UPDATE DownloadQueueItem SET status = 'downloading', progress = 0
        WHERE id = (SELECT id FROM DownloadQueueItem WHERE status = 'queued' ORDER BY addedAt, id LIMIT 1)
          AND (SELECT COUNT(*) FROM DownloadQueueItem WHERE status IN ('downloading', 'importing', 'submissionUnknown'))
            < COALESCE((SELECT maxConcurrentDownloads FROM Settings WHERE id = 1), 3)
        RETURNING id`;
      return rows.length ? prisma.downloadQueueItem.findUnique({ where: { id: Number(rows[0].id) } }) : null;
    } catch (error) {
      if (attempt >= 2 || !/SQLITE_BUSY|database is locked|P1008|P2034/i.test(String(error))) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

// Reserve a slot and the oldest waiting row together. Queued jobs survive restarts;
// external submissions with an unknown outcome retain their slot to avoid duplicates.
export function drainDownloadQueue(): Promise<void> {
  requested = true;
  if (draining) return draining;
  draining = (async () => {
    do {
      requested = false;
      while (runner) {
        const item = await claimNextDownload();
        if (!item) break;
        runningItems.add(item.id);
        void runner(item).catch(err => logActivity('warn', 'download-queue', err))
          .finally(() => { runningItems.delete(item.id); void drainDownloadQueue().catch(err => logActivity('warn', 'download-queue', err)); });
      }
    } while (requested);
  })().finally(() => { draining = null; });
  return draining;
}

export function wakeDownloadQueue() {
  void drainDownloadQueue().catch(err => logActivity('warn', 'download-queue', err));
}

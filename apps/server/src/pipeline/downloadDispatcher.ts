import type { DownloadQueueItem } from '@prisma/client';
import { prisma, logActivity } from '../db/client.js';

let runner: (item: DownloadQueueItem) => Promise<void>;
let draining: Promise<void> | null = null;
let requested = false;

export function registerDownloadRunner(callback: typeof runner) { runner = callback; }

// Reserve a slot and the oldest waiting row together. Queued jobs survive restarts;
// external submissions with an unknown outcome retain their slot to avoid duplicates.
export function drainDownloadQueue(): Promise<void> {
  requested = true;
  if (draining) return draining;
  draining = (async () => {
    do {
      requested = false;
      while (runner) {
        const item = await prisma.$transaction(async tx => {
          const settings = await tx.settings.findUnique({ where: { id: 1 } });
          const active = await tx.downloadQueueItem.count({ where: {
            status: { in: ['downloading', 'importing', 'submissionUnknown'] },
          } });
          if (active >= (settings?.maxConcurrentDownloads ?? 3)) return null;
          const next = await tx.downloadQueueItem.findFirst({ where: { status: 'queued' },
            orderBy: [{ addedAt: 'asc' }, { id: 'asc' }] });
          if (!next) return null;
          const claimed = await tx.downloadQueueItem.updateMany({ where: { id: next.id, status: 'queued' },
            data: { status: 'downloading', progress: 0 } });
          return claimed.count ? { ...next, status: 'downloading' } : null;
        });
        if (!item) break;
        void runner(item).catch(err => logActivity('warn', 'download-queue', err))
          .finally(() => { void drainDownloadQueue().catch(err => logActivity('warn', 'download-queue', err)); });
      }
    } while (requested);
  })().finally(() => { draining = null; });
  return draining;
}

export function wakeDownloadQueue() {
  void drainDownloadQueue().catch(err => logActivity('warn', 'download-queue', err));
}

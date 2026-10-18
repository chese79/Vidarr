import type { DownloadQueueItem } from '@prisma/client';
import { prisma } from '../db/client.js';
import { NotAVideoError } from '../media/inspection.js';
import { DAY } from './policy.js';

export async function noteRecordingFailure(item: DownloadQueueItem, error: unknown) {
  if (item.musicVideoId !== null || !item.recordingId) return;
  const key = `acquisition:${item.recordingId}`, previous = await prisma.liveSearchJournal.findUnique({ where: { key } });
  const failures = (previous?.failures ?? 0) + 1;
  const data = { provider: 'acquisition', failures, outcome: error instanceof NotAVideoError ? 'contentReviewRequired' : 'failed',
    lastSearchAt: new Date(), retryAt: new Date(Date.now() + Math.min(DAY, 5 * 60000 * 2 ** Math.min(failures - 1, 9))), expiresAt: new Date(Date.now() + 365 * DAY) };
  await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, ...data }, update: data });
  if (item.recordingSourceId) {
    if (error instanceof NotAVideoError) {
      await prisma.recordingSource.updateMany({ where: { id: item.recordingSourceId }, data: { accepted: false } });
      await prisma.recording.update({ where: { id: item.recordingId }, data: { videoVerified: false, reviewStatus: 'needsContentReview' } });
    } else if (/video unavailable|has been removed|video has been deleted|HTTP Error (404|410)/i.test(String(error))) {
      await prisma.recordingSource.updateMany({ where: { id: item.recordingSourceId }, data: { available: false } });
    }
  }
}

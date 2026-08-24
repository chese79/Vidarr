import { prisma } from '../db/client.js';

const RETENTION_DAYS = 90;

// Unbounded ActivityLog/History growth is the one thing nothing else in the
// scheduler guards against — everything else is naturally bounded (queue
// items get deleted, artists/videos are user-managed) but these are pure
// append logs.
export async function pruneOldLogs(): Promise<{ activityLogDeleted: number; historyDeleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);

  const activityLogResult = await prisma.activityLog.deleteMany({ where: { date: { lt: cutoff } } });
  const historyResult = await prisma.history.deleteMany({ where: { date: { lt: cutoff } } });

  return { activityLogDeleted: activityLogResult.count, historyDeleted: historyResult.count };
}

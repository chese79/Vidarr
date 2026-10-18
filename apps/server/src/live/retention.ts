import { prisma } from '../db/client.js';
import { DAY, liveConfiguration } from './policy.js';

export async function expireLiveDiscovery(now = new Date()) {
  const { policy } = await liveConfiguration();
  const cutoff = new Date(now.getTime() - policy.discoveryRetentionDays * DAY);
  const expired = await prisma.livePerformance.findMany({ where: { userEdited: false, monitored: false, ignored: false,
    lastEvidenceAt: { lt: cutoff }, identityStatus: 'reference', recordings: { none: {} }, views: { none: {} }, rules: { none: {} }, credits: { none: {} },
    songs: { none: { OR: [{ coverage: { some: {} } }, { playlistItems: { some: {} } }, { views: { some: {} } }, { credits: { some: {} } }] } } }, select: { id: true }, take: 100 });
  for (const { id } of expired) await prisma.$transaction(async tx => {
    // Check again in the write transaction; a concurrent review or acquisition protects its event.
    const safe = await tx.livePerformance.findFirst({ where: { id, userEdited: false, monitored: false, recordings: { none: {} }, views: { none: {} } } });
    if (!safe) return;
    await tx.liveSongPerformance.deleteMany({ where: { performanceId: id } });
    await tx.livePerformance.delete({ where: { id } });
  });
  await prisma.liveSearchJournal.deleteMany({ where: { expiresAt: { lt: now } } });
  return `${expired.length} expired unowned live discoveries; playback history retained`;
}

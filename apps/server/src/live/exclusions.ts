import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';

// Keep the ledger when disabled, matching music-video exclusions. Re-enabling
// the setting restores its protection; disabling it permits future discovery.
export async function liveScanExcluded(fingerprints: string[], db: Prisma.TransactionClient = prisma): Promise<boolean> {
  const settings = await db.settings.findUnique({ where: { id: 1 }, select: { excludeDeletedVideosFromScans: true } });
  if (!settings?.excludeDeletedVideosFromScans || !fingerprints.length) return false;
  return Boolean(await db.liveExclusion.count({ where: { fingerprint: { in: fingerprints } } }));
}

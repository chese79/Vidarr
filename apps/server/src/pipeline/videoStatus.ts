import { prisma } from '../db/client.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
export { computeMusicVideoStatus as computeVideoStatus } from '../catalog/musicVideoPolicy.js';
export type { MusicVideoStatusInput as VideoStatusInput } from '../catalog/musicVideoPolicy.js';

export { effectivePlayCount } from '../catalog/playCounts.js';

export async function hasActiveDownload(musicVideoId: number): Promise<boolean> {
  const existing = await prisma.downloadQueueItem.findFirst({
    where: { musicVideoId, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } },
    select: { id: true },
  });
  return existing != null;
}

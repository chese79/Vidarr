import { prisma } from '../db/client.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
export { computeMusicVideoStatus as computeVideoStatus } from '../catalog/musicVideoPolicy.js';
export type { MusicVideoStatusInput as VideoStatusInput } from '../catalog/musicVideoPolicy.js';

export function effectivePlayCount(file: { playCount: number | null } | null, videos: { available: boolean; matchConfidence: string | null; playCount: number | null }[]): number | null {
  if (file?.playCount != null) return file.playCount;
  const counts = videos.filter(video => video.available && video.matchConfidence == null)
    .map(video => video.playCount).filter((count): count is number => count != null);
  return counts.length ? Math.max(...counts) : null;
}

export async function hasActiveDownload(musicVideoId: number): Promise<boolean> {
  const existing = await prisma.downloadQueueItem.findFirst({
    where: { musicVideoId, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } },
    select: { id: true },
  });
  return existing != null;
}

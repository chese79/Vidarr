import { Prisma } from '@prisma/client';

export function effectivePlayCount(file: { playCount: number | null } | null, videos: { available: boolean; matchConfidence: string | null; playCount: number | null }[]): number | null {
  if (file?.playCount != null) return file.playCount;
  const counts = videos.filter(video => video.available && video.matchConfidence == null)
    .map(video => video.playCount).filter((count): count is number => count != null);
  return counts.length ? Math.max(...counts) : null;
}

// Both paths prefer a known local count (including zero), then the maximum
// confirmed enabled-server count. Unknown stays null; copies are never summed.
export function effectivePlayCountSql(file: Prisma.Sql, confirmedMaximum: Prisma.Sql) {
  return Prisma.sql`COALESCE(${file}, ${confirmedMaximum})`;
}

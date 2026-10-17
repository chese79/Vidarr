import { prisma } from '../db/client.js';
import { normalizeTitle } from './normalize.js';

export async function loadScanExclusions(artistId?: number): Promise<Map<number, Set<string>>> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { excludeDeletedVideosFromScans: true } });
  const exclusions = new Map<number, Set<string>>();
  if (!settings?.excludeDeletedVideosFromScans) return exclusions;
  const records = await prisma.deletedVideoRecord.findMany({ where: artistId == null ? {} : { artistId }, select: { artistId: true, identities: true } });
  for (const record of records) {
    const keys = exclusions.get(record.artistId) ?? new Set<string>();
    for (const key of JSON.parse(record.identities) as string[]) keys.add(key);
    exclusions.set(record.artistId, keys);
  }
  return exclusions;
}

export function isScanExcluded(exclusions: Map<number, Set<string>>, artistId: number, item: { title?: string; imvdbVideoId?: string | null; youtubeVideoId?: string | null; filePath?: string }): boolean {
  const keys = exclusions.get(artistId);
  return Boolean(keys && ((item.imvdbVideoId && keys.has(`imvdb:${item.imvdbVideoId}`))
    || (item.youtubeVideoId && keys.has(`youtube:${item.youtubeVideoId}`))
    || (item.filePath && keys.has(`local:${item.filePath}`)) || (item.title && keys.has(`title:${normalizeTitle(item.title)}`))));
}

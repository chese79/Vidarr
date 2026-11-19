import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

export interface PlayCountSyncResult {
  matched: number;
  unmatched: number;
}

// Full inventory reads already contain native counts. Refresh local-file
// caches from confirmed IDs without a second round of title searches/HTTP.
export async function syncCachedFilePlayCounts(connectorId: number): Promise<number> {
  const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
  const copies = await prisma.libraryVideo.findMany({ where: { connectorId, libraryId: connector.videoLibraryId,
    available: true, matchConfidence: null, musicVideoId: { not: null }, playCount: { not: null } },
    select: { musicVideoId: true, playCount: true, musicVideo: { select: { file: { select: { id: true, playCount: true } },
      artist: { select: { rootFolder: { select: { targetConnectorId: true } } } } } } } });
  const planned = new Map<number, { fileId: number; previous: number | null; count: number; unmapped: boolean }>();
  for (const copy of copies) {
    const video = copy.musicVideo;
    if (!video?.file || copy.musicVideoId == null) continue;
    const target = video.artist.rootFolder.targetConnectorId;
    if (target != null && target !== connectorId) continue;
    planned.set(copy.musicVideoId, { fileId: video.file.id, previous: video.file.playCount,
      count: Math.max(planned.get(copy.musicVideoId)?.count ?? 0, copy.playCount!), unmapped: target == null });
  }
  const unmapped = [...planned].filter(([, value]) => value.unmapped).map(([id]) => id);
  for (let offset = 0; offset < unmapped.length; offset += 400) {
    const others = await prisma.libraryVideo.findMany({ where: { musicVideoId: { in: unmapped.slice(offset, offset + 400) },
      available: true, matchConfidence: null, playCount: { not: null }, connector: { enabled: true } },
      select: { musicVideoId: true, playCount: true, libraryId: true, connector: { select: { videoLibraryId: true } } } });
    for (const copy of others) if (copy.libraryId === copy.connector.videoLibraryId) {
      const item = planned.get(copy.musicVideoId!);
      if (item) item.count = Math.max(item.count, copy.playCount!);
    }
  }
  const changed = [...planned.values()].filter(item => item.previous !== item.count);
  for (let offset = 0; offset < changed.length; offset += 100) await prisma.$transaction(changed.slice(offset, offset + 100).map(item =>
    prisma.musicVideoFile.update({ where: { id: item.fileId }, data: { playCount: item.count, playCountSyncedAt: new Date() } })));
  return changed.length;
}

// Syncs MusicVideoFile.playCount from a connector's video library — reuses
// the exact same item-matching logic playlist push uses (findLibraryItem),
// since both need to resolve "this vidarr video" to "that Plex/Jellyfin
// item" in the connector's video library.
export async function syncPlayCounts(connectorId: number): Promise<PlayCountSyncResult> {
  const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
  const provider = getLibraryConnectorProvider(connector.type);
  if (!provider.findLibraryItem) {
    throw new Error(`${connector.type} does not support play-count sync`);
  }
  if (!connector.videoLibraryId) {
    throw new Error('No video library selected for this connector — pick one on the Library Connectors page first.');
  }

  const files = await prisma.musicVideoFile.findMany({
    include: { musicVideo: { include: { artist: true } } },
  });

  let matched = 0;
  let unmatched = 0;
  for (const file of files) {
    try {
      const match = await provider.findLibraryItem(connector, {
        artistName: file.musicVideo.artist.name,
        title: file.musicVideo.title,
      });
      if (match) {
        await prisma.musicVideoFile.update({
          where: { id: file.id },
          data: { playCount: match.playCount, playCountSyncedAt: new Date() },
        });
        matched++;
      } else {
        unmatched++;
      }
    } catch (err) {
      unmatched++;
      await logActivity('warn', 'play-count-sync', err);
    }
  }

  return { matched, unmatched };
}

import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

export interface PlayCountSyncResult {
  matched: number;
  unmatched: number;
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

import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from './normalize.js';

export async function reconcilePendingImports(): Promise<{ checked: number; confirmed: number }> {
  const pending = await prisma.musicVideo.findMany({
    where: { awaitingServerScanAt: { not: null }, hasFile: true },
    include: { artist: { include: { rootFolder: { include: { targetConnector: true } } } } },
  });
  const byConnector = new Map<number, typeof pending>();
  for (const video of pending) {
    const connector = video.artist.rootFolder.targetConnector;
    if (!connector?.enabled || !connector.videoLibraryId) continue;
    const group = byConnector.get(connector.id) ?? [];
    group.push(video);
    byConnector.set(connector.id, group);
  }

  let confirmed = 0;
  for (const videos of byConnector.values()) {
    const connector = videos[0].artist.rootFolder.targetConnector!;
    const provider = getLibraryConnectorProvider(connector.type);
    if (!provider.fetchVideos) continue;
    try {
      const serverVideos = await provider.fetchVideos(connector);
      if (!serverVideos.length) continue;
      for (const video of videos) {
        const matches = serverVideos.filter((item) => normalizeTitle(item.artistName) === normalizeTitle(video.artist.name)
          && normalizeTitle(item.title) === normalizeTitle(video.title)
          && (video.releaseYear == null || item.releaseYear == null || video.releaseYear === item.releaseYear)
          && (video.durationSeconds == null || item.durationSeconds == null
            || Math.abs(video.durationSeconds - item.durationSeconds) <= 10));
        if (matches.length !== 1) continue;
        const match = matches[0];
        const existing = await prisma.libraryVideo.findUnique({
          where: { connectorId_externalId: { connectorId: connector.id, externalId: match.externalId } },
        });
        if (existing?.rejectedMusicVideoId === video.id || (existing?.musicVideoId && existing.musicVideoId !== video.id)) continue;
        const now = new Date();
        await prisma.$transaction([
          prisma.libraryVideo.upsert({
            where: { connectorId_externalId: { connectorId: connector.id, externalId: match.externalId } },
            update: { musicVideoId: video.id, matchConfidence: null, available: true, lastSyncedAt: now,
              title: match.title, normalizedTitle: normalizeTitle(match.title), artistName: match.artistName,
              normalizedArtistName: normalizeTitle(match.artistName), releaseYear: match.releaseYear ?? null,
              durationSeconds: match.durationSeconds ?? null, path: match.path ?? null,
              playCount: match.playCount ?? null, hasThumbnail: match.hasThumbnail ?? false },
            create: { connectorId: connector.id, externalId: match.externalId, musicVideoId: video.id,
              title: match.title, normalizedTitle: normalizeTitle(match.title), artistName: match.artistName,
              normalizedArtistName: normalizeTitle(match.artistName), releaseYear: match.releaseYear ?? null,
              durationSeconds: match.durationSeconds ?? null, path: match.path ?? null,
              playCount: match.playCount ?? null, hasThumbnail: match.hasThumbnail ?? false },
          }),
          prisma.musicVideo.update({ where: { id: video.id }, data: { awaitingServerScanAt: null } }),
          prisma.artist.update({ where: { id: video.artistId }, data: { reconciledAt: now } }),
        ]);
        confirmed++;
      }
    } catch (err) {
      await logActivity('warn', 'pending-import-reconciliation', err);
    }
  }
  return { checked: pending.length, confirmed };
}

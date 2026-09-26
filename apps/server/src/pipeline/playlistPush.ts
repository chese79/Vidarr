import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

export async function pushPlaylist(playlistId: number, connectorId: number) {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { items: { orderBy: { sortOrder: 'asc' }, include: { musicVideo: { include: { artist: true, libraryVideos: true } } } } },
  });
  if (!playlist) throw new Error('Playlist not found');
  if (playlist.targetConnectorId && playlist.targetConnectorId !== connectorId) {
    throw new Error('Playlist is bound to a different playback library');
  }
  const connector = await prisma.libraryConnector.findUnique({ where: { id: connectorId } });
  if (!connector) throw new Error('Connector not found');
  if (!connector.enabled || !connector.videoLibraryId) throw new Error('Playback library is disabled or not selected');
  const provider = getLibraryConnectorProvider(connector.type);
  if (!provider.pushPlaylist) throw new Error(`${connector.type} does not support playlist push`);

  const existingSync = await prisma.playlistSync.findUnique({
    where: { playlistId_connectorId: { playlistId, connectorId } },
  });
  const playable = playlist.items.filter((item) => (!playlist.targetConnectorId && item.musicVideo.hasFile)
    || item.musicVideo.libraryVideos.some((video) => video.connectorId === connectorId && video.available && video.matchConfidence === null));
  try {
    if (existingSync?.remotePlaylistId && playable.length !== playlist.items.length) {
      throw new Error(`Keeping the existing playlist: ${playlist.items.length - playable.length} item(s) are not confirmed available in this playback library`);
    }
    const result = await provider.pushPlaylist(connector, {
      name: playlist.name,
      items: playable.map((item) => ({ artistName: item.musicVideo.artist.name, title: item.musicVideo.title })),
      existingRemoteId: existingSync?.remotePlaylistId ?? null,
    });
    await prisma.playlistSync.upsert({
      where: { playlistId_connectorId: { playlistId, connectorId } },
      update: { remotePlaylistId: result.remotePlaylistId, lastPushedAt: new Date(), lastPushStatus: result.unmatchedTitles.length ? 'partial' : 'success', lastPushError: null, unmatchedCount: result.unmatchedTitles.length },
      create: { playlistId, connectorId, remotePlaylistId: result.remotePlaylistId, lastPushedAt: new Date(), lastPushStatus: result.unmatchedTitles.length ? 'partial' : 'success', unmatchedCount: result.unmatchedTitles.length },
    });
    return { ok: true, ...result };
  } catch (err) {
    const message = (err as Error).message;
    await prisma.playlistSync.upsert({
      where: { playlistId_connectorId: { playlistId, connectorId } },
      update: { lastPushedAt: new Date(), lastPushStatus: 'failed', lastPushError: message },
      create: { playlistId, connectorId, lastPushedAt: new Date(), lastPushStatus: 'failed', lastPushError: message },
    });
    throw err;
  }
}

// Only previously published smart playlists are republished automatically.
export async function republishChangedSmartPlaylist(playlistId: number, changed: boolean): Promise<number> {
  const syncs = await prisma.playlistSync.findMany({
    where: { playlistId, remotePlaylistId: { not: null }, ...(changed ? {} : { lastPushStatus: { in: ['failed', 'partial'] } }) },
    select: { connectorId: true },
  });
  let pushed = 0;
  for (const sync of syncs) {
    try { await pushPlaylist(playlistId, sync.connectorId); pushed++; } catch (err) {
      await prisma.playlistSync.update({
        where: { playlistId_connectorId: { playlistId, connectorId: sync.connectorId } },
        data: { lastPushStatus: 'failed', lastPushError: (err as Error).message, lastPushedAt: new Date() },
      });
    }
  }
  return pushed;
}

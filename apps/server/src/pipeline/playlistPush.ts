import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

export async function pushPlaylist(playlistId: number, connectorId: number) {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    // `id` as a tie-break keeps the pushed order deterministic even if two
    // items ever share a sortOrder (legacy rows created before add used max+1).
    include: { items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { musicVideo: { include: { artist: true, libraryVideos: { orderBy: { id: 'asc' } } } } } } },
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
    if (playable.length === 0) {
      throw new Error('This playlist has no videos available in that playback library to push');
    }
    const result = await provider.pushPlaylist(connector, {
      name: playlist.name,
      items: playable.map((item) => ({
        artistName: item.musicVideo.artist.name,
        title: item.musicVideo.title,
        // The id the library sync already settled on for this exact video, so
        // the provider doesn't have to guess it again from the title.
        externalId: item.musicVideo.libraryVideos.find((video) => video.connectorId === connectorId
          && video.available && video.matchConfidence === null)?.externalId,
      })),
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

// Removes the copy of a playlist this app published to one connector, then
// forgets the link. The remote delete happens first and the sync row is only
// removed once it succeeds, so a failure (server offline) leaves the link in
// place and the user can simply retry — never an orphan we've lost track of.
export async function unpublishPlaylist(playlistId: number, connectorId: number): Promise<boolean> {
  const sync = await prisma.playlistSync.findUnique({
    where: { playlistId_connectorId: { playlistId, connectorId } },
    include: { connector: true },
  });
  if (!sync) return false;
  if (sync.remotePlaylistId) {
    const provider = getLibraryConnectorProvider(sync.connector.type);
    if (!provider.deletePlaylist) throw new Error(`${sync.connector.type} does not support removing playlists`);
    await provider.deletePlaylist(sync.connector, sync.remotePlaylistId);
  }
  await prisma.playlistSync.delete({ where: { id: sync.id } });
  return true;
}

// Best-effort removal of every published copy, used when the playlist itself
// is being deleted. Reports per-connector failures instead of throwing so one
// unreachable server can't block (or hide the result of) the others.
export async function removeRemoteCopies(playlistId: number): Promise<{
  removedRemote: number;
  failedRemote: { connectorName: string; error: string }[];
}> {
  const syncs = await prisma.playlistSync.findMany({
    where: { playlistId, remotePlaylistId: { not: null } },
    include: { connector: { select: { name: true } } },
  });
  let removedRemote = 0;
  const failedRemote: { connectorName: string; error: string }[] = [];
  for (const sync of syncs) {
    try {
      await unpublishPlaylist(playlistId, sync.connectorId);
      removedRemote++;
    } catch (err) {
      failedRemote.push({ connectorName: sync.connector.name, error: (err as Error).message });
    }
  }
  return { removedRemote, failedRemote };
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

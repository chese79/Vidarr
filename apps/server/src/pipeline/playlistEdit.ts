import { randomInt } from 'node:crypto';
import type { UpdatePlaylist } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { regenerateSmartPlaylist } from './playlistGenerator.js';

// Carries the HTTP status the route should answer with, so the rules below can
// stay in one testable place instead of being tangled into the Fastify handler.
export class PlaylistEditError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = 'PlaylistEditError';
  }
}

// Applies a PATCH to a playlist. Returns the regeneration outcome when the edit
// changed what a smart playlist should contain (so the caller can republish),
// or null when membership wasn't affected (e.g. a rename).
export async function updatePlaylist(
  id: number,
  body: UpdatePlaylist,
): Promise<{ regenerated: { matchedCount: number; changed: boolean } | null }> {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      items: { select: { musicVideoId: true } },
      syncs: { select: { connectorId: true, remotePlaylistId: true, connector: { select: { name: true } } } },
    },
  });
  if (!playlist) throw new PlaylistEditError('Playlist not found', 404);

  const isSmart = playlist.kind === 'smart';
  const touchesRules = body.filters !== undefined || body.matchMode !== undefined
    || body.regenerateIntervalMinutes !== undefined || body.sortMode !== undefined || body.maxVideos !== undefined;
  if (!isSmart && touchesRules && !body.replaceFromFilters) {
    throw new PlaylistEditError('Only smart playlists have rules. A static playlist’s videos and order are edited directly.', 400);
  }
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;

  let rebound = false;
  if (body.targetConnectorId !== undefined && body.targetConnectorId !== playlist.targetConnectorId) {
    const next = body.targetConnectorId;
    if (next !== null) {
      const connector = await prisma.libraryConnector.findUnique({ where: { id: next } });
      const usable = Boolean(connector?.enabled && connector.videoLibraryId
        && getLibraryConnectorProvider(connector.type).pushPlaylist);
      if (!usable) throw new PlaylistEditError('Select an enabled Plex or Jellyfin video library', 400);
    }

    // Moving a published playlist would leave its old copy behind with nothing
    // pointing at it (push only ever talks to the bound library), so make the
    // user remove it deliberately instead of orphaning it.
    const stranded = playlist.syncs.filter((sync) => sync.remotePlaylistId && sync.connectorId !== next);
    if (stranded.length) {
      throw new PlaylistEditError(
        `Remove this playlist from ${stranded.map((sync) => sync.connector.name).join(', ')} before changing its playback library`,
        409,
      );
    }

    if (!isSmart && next !== null && playlist.items.length) {
      const ids = playlist.items.map((item) => item.musicVideoId);
      const availableHere = await prisma.libraryVideo.findMany({
        where: { musicVideoId: { in: ids }, connectorId: next, available: true, matchConfidence: null, connector: { enabled: true } },
        select: { musicVideoId: true },
      });
      const present = new Set(availableHere.map((video) => video.musicVideoId));
      const missing = ids.filter((videoId) => !present.has(videoId)).length;
      if (missing) {
        throw new PlaylistEditError(`${missing} video(s) in this playlist aren’t available in that library. Remove them first.`, 409);
      }
    }

    data.targetConnectorId = next;
    rebound = true;
  }

  let sortChanged = false;
  if (isSmart || body.replaceFromFilters) {
    if (body.maxVideos !== undefined) data.maxVideos = body.maxVideos;
    if (!isSmart && !playlist.ruleFilters && !body.filters) throw new PlaylistEditError("Select filters before replacing videos", 400);
    if (body.filters) data.ruleFilters = JSON.stringify(body.filters);
    if (body.matchMode) data.ruleMatchMode = body.matchMode;
    if (!playlist.ruleMatchMode && body.replaceFromFilters && !body.matchMode) data.ruleMatchMode = 'all';
    if (body.regenerateIntervalMinutes !== undefined) data.regenerateIntervalMinutes = body.regenerateIntervalMinutes;
    if (body.sortMode && body.sortMode !== playlist.sortMode) {
      data.sortMode = body.sortMode;
      // A fresh seed only when switching *to* shuffle; re-saving an already
      // shuffled playlist keeps its seed so the order doesn't reshuffle on a
      // no-op edit (the whole point of the seed is a repeatable order).
      data.shuffleSeed = body.sortMode === 'shuffle' ? randomInt(0, 2 ** 31) : null;
      sortChanged = true;
    }
  }

  await prisma.playlist.update({ where: { id }, data });

  const membershipAffected = (isSmart || body.replaceFromFilters) && (body.filters !== undefined || body.matchMode !== undefined || body.maxVideos !== undefined || rebound || sortChanged);
  return { regenerated: membershipAffected ? await regenerateSmartPlaylist(id, !isSmart) : null };
}

// Rewrites a static playlist's order. Requires the complete, exact set of
// current items: a stale client (someone added/removed a video meanwhile) gets
// a clear conflict instead of an order that silently drops or resurrects items.
export async function reorderPlaylistItems(id: number, musicVideoIds: number[]): Promise<void> {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    select: { kind: true, items: { select: { musicVideoId: true } } },
  });
  if (!playlist) throw new PlaylistEditError('Playlist not found', 404);
  if (playlist.kind === 'smart') {
    throw new PlaylistEditError('A smart playlist’s order comes from its rules. Change its order setting instead.', 409);
  }

  const current = new Set(playlist.items.map((item) => item.musicVideoId));
  const requested = new Set(musicVideoIds);
  const sameSet = requested.size === musicVideoIds.length
    && requested.size === current.size
    && musicVideoIds.every((videoId) => current.has(videoId));
  if (!sameSet) {
    throw new PlaylistEditError('This playlist changed since you loaded it. Refresh and try again.', 409);
  }

  await prisma.$transaction(musicVideoIds.map((musicVideoId, sortOrder) => prisma.playlistItem.update({
    where: { playlistId_musicVideoId: { playlistId: id, musicVideoId } },
    data: { sortOrder },
  })));
}

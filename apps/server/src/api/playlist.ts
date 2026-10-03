import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CreatePlaylistSchema,
  GeneratePlaylistBodySchema,
  ReorderPlaylistItemsSchema,
  UpdatePlaylistSchema,
} from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { generatePlaylistFromFilters, regenerateSmartPlaylist } from '../pipeline/playlistGenerator.js';
import { PlaylistEditError, reorderPlaylistItems, updatePlaylist } from '../pipeline/playlistEdit.js';
import {
  pushPlaylist,
  removeRemoteCopies,
  republishChangedSmartPlaylist,
  unpublishPlaylist,
} from '../pipeline/playlistPush.js';

const playlistInclude = {
  items: {
    // `id` breaks ties between rows that share a sortOrder (legacy data from
    // before adds used max+1), so the order is always stable.
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    include: { musicVideo: { include: { artist: true } } },
  },
  syncs: { include: { connector: true } },
};

function sendEditError(reply: FastifyReply, err: unknown) {
  if (err instanceof PlaylistEditError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

function serializeSyncs(syncs: Awaited<ReturnType<typeof prisma.playlistSync.findMany>>) {
  return syncs.map((s: any) => ({
    id: s.id,
    connectorId: s.connectorId,
    connectorName: s.connector.name,
    connectorType: s.connector.type,
    remotePlaylistId: s.remotePlaylistId,
    lastPushedAt: s.lastPushedAt,
    lastPushStatus: s.lastPushStatus,
    lastPushError: s.lastPushError,
    unmatchedCount: s.unmatchedCount,
  }));
}

export async function playlistRoutes(app: FastifyInstance) {
  async function validPlaybackConnector(id: number | null | undefined): Promise<boolean> {
    if (id == null) return true;
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    return Boolean(connector?.enabled && connector.videoLibraryId && getLibraryConnectorProvider(connector.type).pushPlaylist);
  }

  app.get('/api/v1/playlist', async () => {
    const playlists = await prisma.playlist.findMany({
      include: playlistInclude,
      orderBy: { createdAt: 'desc' },
    });
    return playlists.map((p) => ({ ...p, syncs: serializeSyncs(p.syncs) }));
  });

  app.post('/api/v1/playlist', async (req, reply) => {
    const body = CreatePlaylistSchema.parse(req.body);
    if (!await validPlaybackConnector(body.targetConnectorId)) return reply.code(400).send({ error: 'Select an enabled Plex or Jellyfin video library' });
    const created = await prisma.playlist.create({
      data: { name: body.name, targetConnectorId: body.targetConnectorId ?? null },
      include: playlistInclude,
    });
    reply.code(201);
    return { ...created, syncs: serializeSyncs(created.syncs) };
  });

  app.post('/api/v1/playlist/generate', async (req, reply) => {
    const body = GeneratePlaylistBodySchema.parse(req.body);
    if (!await validPlaybackConnector(body.targetConnectorId)) return reply.code(400).send({ error: 'Select an enabled Plex or Jellyfin video library' });
    try {
      return await generatePlaylistFromFilters(body.name, body.filters, body.matchMode, {
        smart: body.smart,
        regenerateIntervalMinutes: body.regenerateIntervalMinutes,
        targetConnectorId: body.targetConnectorId,
        sortMode: body.sortMode,
      });
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/v1/playlist/:id/regenerate', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { kind: true } });
    if (!playlist || playlist.kind !== 'smart') return reply.code(404).send({ error: 'Smart playlist not found' });
    const result = await regenerateSmartPlaylist(id);
    await republishChangedSmartPlaylist(id, result.changed);
    return result;
  });

  app.patch('/api/v1/playlist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdatePlaylistSchema.parse(req.body);
    try {
      const { regenerated } = await updatePlaylist(id, body);
      // An edit that changed a smart playlist's contents republishes it to
      // wherever it was already published — same rule as a scheduled regenerate.
      if (regenerated) await republishChangedSmartPlaylist(id, regenerated.changed);
    } catch (err) {
      return sendEditError(reply, err);
    }
    const updated = await prisma.playlist.findUniqueOrThrow({ where: { id }, include: playlistInclude });
    return { ...updated, syncs: serializeSyncs(updated.syncs) };
  });

  // Deleting also removes the copies this app published to Plex/Jellyfin (they
  // are vidarr-managed — every push already replaces them wholesale), unless the
  // caller asks to keep them. A remote that can't be reached is reported, not
  // fatal: the local playlist is still deleted so it can't be stuck forever
  // behind an offline server, and the response says what needs manual cleanup.
  app.delete('/api/v1/playlist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const keepRemote = (req.query as { keepRemote?: string }).keepRemote === 'true';
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { id: true } });
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
    const result = keepRemote ? { removedRemote: 0, failedRemote: [] } : await removeRemoteCopies(id);
    await prisma.playlist.delete({ where: { id } });
    return result;
  });

  app.put('/api/v1/playlist/:id/items/order', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = ReorderPlaylistItemsSchema.parse(req.body);
    try {
      await reorderPlaylistItems(id, body.musicVideoIds);
    } catch (err) {
      return sendEditError(reply, err);
    }
    reply.code(204);
  });

  app.post('/api/v1/playlist/:id/items', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { kind: true, targetConnectorId: true } });
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
    if (playlist.kind === 'smart') return reply.code(409).send({ error: 'Regenerate this smart playlist from its saved rules' });
    const body = req.body as { musicVideoId: number };
    if (playlist?.targetConnectorId) {
      const available = await prisma.libraryVideo.findFirst({ where: {
        musicVideoId: body.musicVideoId,
        connectorId: playlist.targetConnectorId,
        available: true,
        matchConfidence: null,
        connector: { enabled: true },
      }, select: { id: true } });
      if (!available) return reply.code(409).send({ error: 'Video is not available in this playlist’s playback library' });
    }
    // max+1, not count: after a removal the count lands on an existing
    // sortOrder, giving two items the same position and an unstable order.
    const last = await prisma.playlistItem.aggregate({ where: { playlistId: id }, _max: { sortOrder: true } });
    const item = await prisma.playlistItem
      .create({
        data: { playlistId: id, musicVideoId: body.musicVideoId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      })
      .catch(() => null);
    if (!item) return reply.code(409).send({ error: 'Video already in this playlist' });
    reply.code(201);
    return item;
  });

  app.delete('/api/v1/playlist/:id/items/:musicVideoId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { kind: true } });
    if (playlist?.kind === 'smart') return reply.code(409).send({ error: 'Regenerate this smart playlist from its saved rules' });
    const musicVideoId = Number((req.params as { musicVideoId: string }).musicVideoId);
    await prisma.playlistItem.delete({ where: { playlistId_musicVideoId: { playlistId: id, musicVideoId } } });
    reply.code(204);
  });

  // Unpublish: remove the copy on one connector and forget the link, leaving
  // the vidarr playlist intact (e.g. before moving it to another library).
  app.delete('/api/v1/playlist/:id/push/:connectorId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connectorId = Number((req.params as { connectorId: string }).connectorId);
    try {
      const removed = await unpublishPlaylist(id, connectorId);
      if (!removed) return reply.code(404).send({ error: 'This playlist is not published to that library' });
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
    reply.code(204);
  });

  app.post('/api/v1/playlist/:id/push/:connectorId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connectorId = Number((req.params as { connectorId: string }).connectorId);
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { targetConnectorId: true } });
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
    if (playlist.targetConnectorId && playlist.targetConnectorId !== connectorId) {
      return reply.code(409).send({ error: 'Playlist is bound to a different playback library' });
    }
    const connector = await prisma.libraryConnector.findUnique({ where: { id: connectorId } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });
    if (!getLibraryConnectorProvider(connector.type).pushPlaylist) {
      return reply.code(400).send({ error: `${connector.type} does not support playlist push` });
    }
    try {
      return await pushPlaylist(id, connectorId);
    } catch (err) {
      reply.code(502);
      return { ok: false, remotePlaylistId: null, matchedCount: 0, unmatchedTitles: [], error: (err as Error).message };
    }
  });
}

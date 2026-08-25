import type { FastifyInstance } from 'fastify';
import { CreatePlaylistSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

const playlistInclude = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: { musicVideo: { include: { artist: true } } },
  },
  syncs: { include: { connector: true } },
};

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
  app.get('/api/v1/playlist', async () => {
    const playlists = await prisma.playlist.findMany({
      include: playlistInclude,
      orderBy: { createdAt: 'desc' },
    });
    return playlists.map((p) => ({ ...p, syncs: serializeSyncs(p.syncs) }));
  });

  app.post('/api/v1/playlist', async (req, reply) => {
    const body = CreatePlaylistSchema.parse(req.body);
    const created = await prisma.playlist.create({
      data: { name: body.name },
      include: playlistInclude,
    });
    reply.code(201);
    return { ...created, syncs: serializeSyncs(created.syncs) };
  });

  app.delete('/api/v1/playlist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.playlist.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/playlist/:id/items', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { musicVideoId: number };
    const count = await prisma.playlistItem.count({ where: { playlistId: id } });
    const item = await prisma.playlistItem
      .create({
        data: { playlistId: id, musicVideoId: body.musicVideoId, sortOrder: count },
      })
      .catch(() => null);
    if (!item) return reply.code(409).send({ error: 'Video already in this playlist' });
    reply.code(201);
    return item;
  });

  app.delete('/api/v1/playlist/:id/items/:musicVideoId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const musicVideoId = Number((req.params as { musicVideoId: string }).musicVideoId);
    await prisma.playlistItem.delete({ where: { playlistId_musicVideoId: { playlistId: id, musicVideoId } } });
    reply.code(204);
  });

  // Push is a full replace, not a diff — see PlaylistSync's doc comment in
  // schema.prisma. Only items with a downloaded file make sense to push,
  // since a Plex/Jellyfin item lookup can only ever match something they've
  // already scanned off disk.
  app.post('/api/v1/playlist/:id/push/:connectorId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connectorId = Number((req.params as { connectorId: string }).connectorId);

    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: { items: { include: { musicVideo: { include: { artist: true } } } } },
    });
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });

    const connector = await prisma.libraryConnector.findUnique({ where: { id: connectorId } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    const provider = getLibraryConnectorProvider(connector.type);
    if (!provider.pushPlaylist) {
      return reply.code(400).send({ error: `${connector.type} does not support playlist push` });
    }

    const existingSync = await prisma.playlistSync.findUnique({
      where: { playlistId_connectorId: { playlistId: id, connectorId } },
    });

    const downloaded = playlist.items.filter((i) => i.musicVideo.hasFile);
    try {
      const result = await provider.pushPlaylist(connector, {
        name: playlist.name,
        items: downloaded.map((i) => ({ artistName: i.musicVideo.artist.name, title: i.musicVideo.title })),
        existingRemoteId: existingSync?.remotePlaylistId ?? null,
      });

      const status = result.unmatchedTitles.length === 0 ? 'success' : 'partial';
      await prisma.playlistSync.upsert({
        where: { playlistId_connectorId: { playlistId: id, connectorId } },
        update: {
          remotePlaylistId: result.remotePlaylistId,
          lastPushedAt: new Date(),
          lastPushStatus: status,
          lastPushError: null,
          unmatchedCount: result.unmatchedTitles.length,
        },
        create: {
          playlistId: id,
          connectorId,
          remotePlaylistId: result.remotePlaylistId,
          lastPushedAt: new Date(),
          lastPushStatus: status,
          unmatchedCount: result.unmatchedTitles.length,
        },
      });

      return {
        ok: true,
        remotePlaylistId: result.remotePlaylistId,
        matchedCount: result.matchedCount,
        unmatchedTitles: result.unmatchedTitles,
      };
    } catch (err) {
      await prisma.playlistSync.upsert({
        where: { playlistId_connectorId: { playlistId: id, connectorId } },
        update: { lastPushedAt: new Date(), lastPushStatus: 'failed', lastPushError: (err as Error).message },
        create: {
          playlistId: id,
          connectorId,
          lastPushedAt: new Date(),
          lastPushStatus: 'failed',
          lastPushError: (err as Error).message,
        },
      });
      reply.code(502);
      return { ok: false, remotePlaylistId: null, matchedCount: 0, unmatchedTitles: [], error: (err as Error).message };
    }
  });
}

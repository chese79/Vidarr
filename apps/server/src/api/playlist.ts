import type { FastifyInstance } from 'fastify';
import { CreatePlaylistSchema, GeneratePlaylistBodySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { generatePlaylistFromFilters, regenerateSmartPlaylist } from '../pipeline/playlistGenerator.js';
import { pushPlaylist, republishChangedSmartPlaylist } from '../pipeline/playlistPush.js';

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

  app.delete('/api/v1/playlist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.playlist.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/playlist/:id/items', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { kind: true, targetConnectorId: true } });
    if (playlist?.kind === 'smart') return reply.code(409).send({ error: 'Regenerate this smart playlist from its saved rules' });
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
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { kind: true } });
    if (playlist?.kind === 'smart') return reply.code(409).send({ error: 'Regenerate this smart playlist from its saved rules' });
    const musicVideoId = Number((req.params as { musicVideoId: string }).musicVideoId);
    await prisma.playlistItem.delete({ where: { playlistId_musicVideoId: { playlistId: id, musicVideoId } } });
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

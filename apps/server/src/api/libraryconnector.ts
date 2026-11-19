import { syncLibraryConnector, ConnectorSyncError } from '../pipeline/librarySync.js';
import type { FastifyInstance } from 'fastify';
import { CreateLibraryConnectorSchema, UpdateLibraryConnectorSchema, DiscoverLibraryConnectorBodySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { syncPlayCounts } from '../pipeline/playCountSync.js';
import { z } from 'zod';
import { discoverPlexServers, discoverJellyfinServers } from '../pipeline/discovery.js';

export async function libraryConnectorRoutes(app: FastifyInstance) {
  app.get('/api/v1/libraryconnector', async () => {
    return (await prisma.libraryConnector.findMany()).map(serializeConnector);
  });

  app.get('/api/v1/libraryvideo', async () => {
    const videos = await prisma.libraryVideo.findMany({
      where: { available: true, connector: { enabled: true } },
      include: {
        connector: { select: { name: true, type: true } },
        musicVideo: { select: { title: true, releaseYear: true, artist: { select: { name: true } } } },
      },
      orderBy: [{ artistName: 'asc' }, { title: 'asc' }],
    });
    // matchedVideo lets the "Needs review" UI show a side-by-side comparison
    // without a second query — only meaningful when matchConfidence is set
    // (a fuzzy, unreviewed match); an exact/confident match doesn't need it.
    return videos.map(({ musicVideo, ...video }) => ({
      ...video,
      matchedVideo: musicVideo
        ? { title: musicVideo.title, releaseYear: musicVideo.releaseYear, artistName: musicVideo.artist.name }
        : null,
    }));
  });

  // Accepts a fuzzy match a sync proposed — clears matchConfidence so the row
  // behaves exactly like an exact match everywhere else in the app from now
  // on (computeVideoStatus and every other consumer only look at
  // musicVideoId, never matchConfidence).
  app.post<{ Params: { id: string } }>('/api/v1/libraryvideo/:id/confirm-match', async (req, reply) => {
    const id = Number(req.params.id);
    const video = await prisma.libraryVideo.findUnique({ where: { id } });
    if (!video) return reply.code(404).send({ error: 'Library video not found' });
    if (!video.musicVideoId) return reply.code(400).send({ error: 'This row has no proposed match to confirm' });
    return prisma.libraryVideo.update({ where: { id }, data: { matchConfidence: null } });
  });

  // Rejects a fuzzy match: clears it and remembers it so the next sync's
  // fuzzy fallback doesn't immediately re-propose the same candidate.
  app.post<{ Params: { id: string } }>('/api/v1/libraryvideo/:id/reject-match', async (req, reply) => {
    const id = Number(req.params.id);
    const video = await prisma.libraryVideo.findUnique({ where: { id } });
    if (!video) return reply.code(404).send({ error: 'Library video not found' });
    if (!video.musicVideoId) return reply.code(400).send({ error: 'This row has no proposed match to reject' });
    return prisma.libraryVideo.update({
      where: { id },
      data: { musicVideoId: null, matchConfidence: null, rejectedMusicVideoId: video.musicVideoId },
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/libraryvideo/:id/thumbnail', async (req, reply) => {
    const video = await prisma.libraryVideo.findUnique({
      where: { id: Number(req.params.id) },
      include: { connector: true },
    });
    if (!video?.available || !video.hasThumbnail) {
      return reply.code(404).send({ error: 'Thumbnail not found' });
    }
    const provider = getLibraryConnectorProvider(video.connector.type);
    if (!provider.fetchVideoThumbnail) {
      return reply.code(404).send({ error: 'Thumbnail not supported' });
    }
    const thumbnail = await provider.fetchVideoThumbnail(video.connector, video.externalId);
    if (!thumbnail) return reply.code(404).send({ error: 'Thumbnail not found' });
    return reply
      .header('Content-Type', thumbnail.contentType)
      .header('Cache-Control', 'private, max-age=3600')
      .send(thumbnail.data);
  });

  // Broadcasts a UDP discovery request on the local network and returns
  // whatever Plex/Jellyfin servers answer — purely a convenience for the "Add
  // connector" form so the host field can be filled in instead of typed by
  // hand. No equivalent protocol exists for Subsonic/Navidrome.
  app.post('/api/v1/libraryconnector/discover', async (req) => {
    const body = DiscoverLibraryConnectorBodySchema.parse(req.body);
    if (body.type === 'plex') return discoverPlexServers();
    return discoverJellyfinServers();
  });

  app.post('/api/v1/libraryconnector', async (req, reply) => {
    const body = CreateLibraryConnectorSchema.parse(req.body);
    const created = await prisma.libraryConnector.create({
      data: {
        name: body.name,
        type: body.type,
        host: body.host,
        authToken: body.authToken ?? null,
        username: body.username ?? null,
        password: body.password ?? null,
        musicLibraryId: body.musicLibraryId ?? null,
        musicPath: body.musicPath ?? null,
        videoLibraryId: body.videoLibraryId ?? null,
        enabled: body.enabled,
      },
    });
    reply.code(201);
    return serializeConnector(created);
  });

  // Lists the connector's library sections so the UI can offer a picker for
  // videoLibraryId — the section holding vidarr's own downloaded videos,
  // which is deliberately never guessed (see providers/library/plex.ts).
  app.get('/api/v1/libraryconnector/:id/sections', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    const provider = getLibraryConnectorProvider(connector.type);
    if (!provider.listSections) return [];
    try {
      return await provider.listSections(connector);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.put('/api/v1/libraryconnector/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdateLibraryConnectorSchema.parse(req.body);
    return serializeConnector(await prisma.libraryConnector.update({ where: { id }, data: body }));
  });

  app.delete('/api/v1/libraryconnector/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.libraryConnector.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/libraryconnector/:id/test', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    const result = await getLibraryConnectorProvider(connector.type).testConnection(connector);
    // musicLibraryId is now a deliberate user choice (see the music-library
    // picker in LibraryConnectorsPage.tsx) — only auto-fill it from Test when
    // nothing has been picked yet. Plex's testConnection always guesses the
    // first "artist" section, so persisting it unconditionally on every Test
    // would silently overwrite a different section the user picked on
    // purpose. userId is never user-chosen (it's resolved from `username`),
    // so it's always safe, and desirable, to keep it fresh.
    const updates: { musicLibraryId?: string; userId?: string } = {};
    if (result.musicLibraryId && !connector.musicLibraryId) updates.musicLibraryId = result.musicLibraryId;
    if (result.userId) updates.userId = result.userId;
    if (Object.keys(updates).length) {
      await prisma.libraryConnector.update({ where: { id }, data: updates });
    }
    return { ok: result.ok, message: result.message };
  });

  app.post('/api/v1/libraryconnector/:id/sync', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try { return await syncLibraryConnector(id); }
    catch (error) { return reply.code(error instanceof ConnectorSyncError ? error.status : 502).send({ error: (error as Error).message }); }
  });

  app.post('/api/v1/libraryconnector/:id/sync-play-counts', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      return await syncPlayCounts(id);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
  // Keep a protected retirement response for previously configured webhooks.
  // Native server counts synchronize independently; payloads never become plays.
  app.post('/api/v1/libraryconnector/:id/playback-webhook', { bodyLimit: 16_384 }, async (req, reply) => {
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    z.object({ NotificationType: z.enum(['PlaybackStart', 'PlaybackProgress', 'PlaybackStop']) }).parse(req.body);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector?.enabled || connector.type !== 'jellyfin' || !connector.videoLibraryId) return reply.code(409).send({ error: 'Select an enabled Jellyfin music-video library for this webhook.' });
    return reply.code(410).send({ error: 'Vidarr play qualification has been removed. Play counts come only from Jellyfin/Plex synchronization.' });
  });
}

function serializeConnector<T extends { authToken: string | null; password: string | null }>(connector: T) {
  const { authToken, password, ...safe } = connector;
  return { ...safe, authToken: null, hasAuthToken: Boolean(authToken), hasPassword: Boolean(password) };
}

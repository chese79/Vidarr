import type { FastifyInstance } from 'fastify';
import { CreateLibraryConnectorSchema, UpdateLibraryConnectorSchema, DiscoverLibraryConnectorBodySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from '../pipeline/normalize.js';
import { syncPlayCounts } from '../pipeline/playCountSync.js';
import { discoverPlexServers, discoverJellyfinServers } from '../pipeline/discovery.js';
import { refreshRecommendations } from '../pipeline/recommendations.js';

export async function libraryConnectorRoutes(app: FastifyInstance) {
  app.get('/api/v1/libraryconnector', async () => {
    return (await prisma.libraryConnector.findMany()).map(serializeConnector);
  });

  app.get('/api/v1/libraryvideo', async () => {
    return prisma.libraryVideo.findMany({
      where: { available: true, connector: { enabled: true } },
      include: { connector: { select: { name: true, type: true } } },
      orderBy: [{ artistName: 'asc' }, { title: 'asc' }],
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
    if (result.musicLibraryId || result.userId) {
      await prisma.libraryConnector.update({
        where: { id },
        data: {
          ...(result.musicLibraryId && { musicLibraryId: result.musicLibraryId }),
          ...(result.userId && { userId: result.userId }),
        },
      });
    }
    return { ok: result.ok, message: result.message };
  });

  app.post('/api/v1/libraryconnector/:id/sync', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    try {
      const syncStartedAt = new Date();
      const artists = await getLibraryConnectorProvider(connector.type).fetchArtists(connector);
      await prisma.$transaction(artists.map((artist) =>
        prisma.libraryArtist.upsert({
          where: { connectorId_externalId: { connectorId: id, externalId: artist.externalId } },
          update: {
            name: artist.name,
            normalizedName: normalizeTitle(artist.name),
            genre: artist.genre ?? null,
            playCount: artist.playCount ?? null,
            lastSyncedAt: new Date(),
          },
          create: {
            connectorId: id,
            externalId: artist.externalId,
            name: artist.name,
            normalizedName: normalizeTitle(artist.name),
            genre: artist.genre ?? null,
            playCount: artist.playCount ?? null,
          },
        }),
      ));
      await prisma.libraryArtist.deleteMany({
        where: { connectorId: id, lastSyncedAt: { lt: syncStartedAt } },
      });

      const provider = getLibraryConnectorProvider(connector.type);
      const videos = provider.fetchVideos && connector.videoLibraryId
        ? await provider.fetchVideos(connector)
        : [];
      if (provider.fetchVideos && connector.videoLibraryId) {
        const canonicalVideos = await prisma.musicVideo.findMany({
          include: { artist: { select: { name: true } } },
        });
        const canonicalByName = new Map(
          canonicalVideos.map((video) => [
            `${normalizeTitle(video.artist.name)}::${normalizeTitle(video.title)}`,
            video.id,
          ]),
        );
        await prisma.libraryVideo.updateMany({ where: { connectorId: id }, data: { available: false } });
        await prisma.$transaction(videos.map((video) => {
          const normalizedArtistName = normalizeTitle(video.artistName);
          const normalizedTitle = normalizeTitle(video.title);
          return prisma.libraryVideo.upsert({
            where: { connectorId_externalId: { connectorId: id, externalId: video.externalId } },
            update: {
              title: video.title,
              normalizedTitle,
              artistName: video.artistName,
              normalizedArtistName,
              releaseYear: video.releaseYear ?? null,
              path: video.path ?? null,
              playCount: video.playCount ?? null,
              hasThumbnail: video.hasThumbnail ?? false,
              available: true,
              lastSyncedAt: new Date(),
              musicVideoId: canonicalByName.get(`${normalizedArtistName}::${normalizedTitle}`) ?? null,
            },
            create: {
              connectorId: id,
              externalId: video.externalId,
              title: video.title,
              normalizedTitle,
              artistName: video.artistName,
              normalizedArtistName,
              releaseYear: video.releaseYear ?? null,
              path: video.path ?? null,
              playCount: video.playCount ?? null,
              hasThumbnail: video.hasThumbnail ?? false,
              musicVideoId: canonicalByName.get(`${normalizedArtistName}::${normalizedTitle}`) ?? null,
            },
          });
        }));
      }

      // Backfill vidarr's own Artist.genre from this connector's synced data
      // when we don't already have one — never overwrites a user-set or
      // previously-matched genre. Matched by normalized name, same
      // comparison used everywhere else in this codebase.
      const genreByNormalizedName = new Map(
        artists.filter((a) => a.genre).map((a) => [normalizeTitle(a.name), a.genre as string]),
      );
      if (genreByNormalizedName.size) {
        const genrelessArtists = await prisma.artist.findMany({
          where: { genre: null },
          select: { id: true, name: true },
        });
        for (const a of genrelessArtists) {
          const genre = genreByNormalizedName.get(normalizeTitle(a.name));
          if (genre) await prisma.artist.update({ where: { id: a.id }, data: { genre } });
        }
      }

      await prisma.libraryConnector.update({
        where: { id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: 'success', lastSyncError: null },
      });
      const recommendations = await refreshRecommendations();
      return {
        ok: true,
        artistCount: artists.length,
        videoCount: videos.length,
        recommendationCount: recommendations.totalRecommendations,
      };
    } catch (err) {
      await prisma.libraryConnector.update({
        where: { id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: 'failed',
          lastSyncError: (err as Error).message,
        },
      });
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/libraryconnector/:id/sync-play-counts', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      return await syncPlayCounts(id);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}

function serializeConnector<T extends { authToken: string | null; password: string | null }>(connector: T) {
  const { authToken, password: _password, ...safe } = connector;
  return { ...safe, authToken: null, hasAuthToken: Boolean(authToken) };
}

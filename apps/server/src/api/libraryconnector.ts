import type { FastifyInstance } from 'fastify';
import { CreateLibraryConnectorSchema, UpdateLibraryConnectorSchema, DiscoverLibraryConnectorBodySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from '../pipeline/normalize.js';
import { syncPlayCounts } from '../pipeline/playCountSync.js';
import { discoverPlexServers, discoverJellyfinServers } from '../pipeline/discovery.js';

export async function libraryConnectorRoutes(app: FastifyInstance) {
  app.get('/api/v1/libraryconnector', async () => {
    return prisma.libraryConnector.findMany();
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
        videoLibraryId: body.videoLibraryId ?? null,
        enabled: body.enabled,
      },
    });
    reply.code(201);
    return created;
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
    return prisma.libraryConnector.update({ where: { id }, data: body });
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
    if (result.musicLibraryId) {
      await prisma.libraryConnector.update({
        where: { id },
        data: { musicLibraryId: result.musicLibraryId },
      });
    }
    return { ok: result.ok, message: result.message };
  });

  app.post('/api/v1/libraryconnector/:id/sync', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    try {
      const artists = await getLibraryConnectorProvider(connector.type).fetchArtists(connector);
      for (const artist of artists) {
        await prisma.libraryArtist.upsert({
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
        });
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
      return { ok: true, artistCount: artists.length };
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

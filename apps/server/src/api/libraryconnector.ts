import type { FastifyInstance } from 'fastify';
import { CreateLibraryConnectorSchema, UpdateLibraryConnectorSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from '../pipeline/normalize.js';

export async function libraryConnectorRoutes(app: FastifyInstance) {
  app.get('/api/v1/libraryconnector', async () => {
    return prisma.libraryConnector.findMany();
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
        enabled: body.enabled,
      },
    });
    reply.code(201);
    return created;
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
}

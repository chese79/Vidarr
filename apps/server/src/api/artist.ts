import type { FastifyInstance } from 'fastify';
import { CreateArtistSchema, UpdateArtistSchema } from '@vidarr/shared-types';
import { prisma, logActivity } from '../db/client.js';
import { sortNameFor } from '../pipeline/normalize.js';
import { refreshArtistMetadata } from '../pipeline/metadataRefresh.js';

export async function artistRoutes(app: FastifyInstance) {
  app.get('/api/v1/artist', async () => {
    return prisma.artist.findMany({ orderBy: { sortName: 'asc' } });
  });

  app.get('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        musicVideos: { orderBy: { releaseYear: { sort: 'asc', nulls: 'last' } } },
      },
    });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    return artist;
  });

  app.post('/api/v1/artist', async (req, reply) => {
    const body = CreateArtistSchema.parse(req.body);
    const created = await prisma.artist.create({
      data: {
        name: body.name,
        sortName: sortNameFor(body.name),
        imvdbArtistId: body.imvdbArtistId ?? null,
        monitored: body.monitored,
        rootFolderId: body.rootFolderId,
        qualityProfileId: body.qualityProfileId,
        posterUrl: body.posterUrl ?? null,
      },
    });
    reply.code(201);
    return created;
  });

  app.put('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdateArtistSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.name) data.sortName = sortNameFor(body.name);

    const before = await prisma.artist.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.artist.update({ where: { id }, data });

    // Turning monitoring on (re-)establishes the artist's full video list from
    // IMVDb immediately, rather than waiting for the next scheduled refresh.
    let videosAdded: number | undefined;
    let metadataRefreshError: string | undefined;
    if (body.monitored === true && !before.monitored && updated.imvdbArtistId) {
      try {
        videosAdded = (await refreshArtistMetadata(id)).videosAdded;
      } catch (err) {
        metadataRefreshError = (err as Error).message;
        await logActivity('warn', 'metadata-refresh:manual', err);
      }
    }

    return { ...updated, videosAdded, metadataRefreshError };
  });

  app.delete('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.artist.delete({ where: { id } });
    reply.code(204);
  });
}

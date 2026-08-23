import type { FastifyInstance } from 'fastify';
import { CreateYoutubeSourceSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { syncYoutubeSource } from '../pipeline/youtubeSync.js';

export async function youtubeSourceRoutes(app: FastifyInstance) {
  app.get('/api/v1/youtubesource', async (req) => {
    const artistId = (req.query as { artistId?: string }).artistId;
    return prisma.youtubeSource.findMany({
      where: artistId ? { artistId: Number(artistId) } : undefined,
    });
  });

  app.post('/api/v1/youtubesource', async (req, reply) => {
    const body = CreateYoutubeSourceSchema.parse(req.body);
    const created = await prisma.youtubeSource.create({ data: body });
    reply.code(201);
    return created;
  });

  app.delete('/api/v1/youtubesource/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.youtubeSource.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/youtubesource/:id/sync', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      return await syncYoutubeSource(id);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}

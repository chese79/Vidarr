import type { FastifyInstance } from 'fastify';
import { CreateIndexerSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { searchIndexer } from '../providers/indexer/torznab.js';

export async function indexerRoutes(app: FastifyInstance) {
  app.get('/api/v1/indexer', async () => {
    return prisma.indexer.findMany();
  });

  app.post('/api/v1/indexer', async (req, reply) => {
    const body = CreateIndexerSchema.parse(req.body);
    const created = await prisma.indexer.create({
      data: {
        name: body.name,
        implementation: body.implementation,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey ?? null,
        categories: JSON.stringify(body.categories),
        enabled: body.enabled,
        priority: body.priority,
      },
    });
    reply.code(201);
    return created;
  });

  app.delete('/api/v1/indexer/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.indexer.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/indexer/:id/test', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const indexer = await prisma.indexer.findUnique({ where: { id } });
    if (!indexer) return reply.code(404).send({ error: 'Indexer not found' });
    try {
      await searchIndexer(indexer, 'test');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });
}

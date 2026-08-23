import type { FastifyInstance } from 'fastify';
import { CreateQualityProfileSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';

export async function qualityProfileRoutes(app: FastifyInstance) {
  app.get('/api/v1/qualityprofile', async () => {
    return prisma.qualityProfile.findMany({ include: { items: true } });
  });

  app.post('/api/v1/qualityprofile', async (req, reply) => {
    const body = CreateQualityProfileSchema.parse(req.body);
    const created = await prisma.qualityProfile.create({
      data: {
        name: body.name,
        cutoffQualityId: body.cutoffQualityId,
        items: {
          create: body.items.map((i) => ({ qualityId: i.qualityId, allowed: i.allowed })),
        },
      },
      include: { items: true },
    });
    reply.code(201);
    return created;
  });

  app.delete('/api/v1/qualityprofile/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.qualityProfile.delete({ where: { id } });
    reply.code(204);
  });

  app.get('/api/v1/quality', async () => {
    return prisma.quality.findMany({ orderBy: { weight: 'asc' } });
  });
}

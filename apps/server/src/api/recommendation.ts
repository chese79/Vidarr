import type { FastifyInstance } from 'fastify';
import { AddRecommendationBodySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { refreshRecommendations } from '../pipeline/recommendations.js';
import { sortNameFor } from '../pipeline/normalize.js';

export async function recommendationRoutes(app: FastifyInstance) {
  app.get('/api/v1/recommendation', async () => {
    return prisma.recommendation.findMany({
      where: { dismissed: false, addedArtistId: null },
      orderBy: { aggregateScore: 'desc' },
      include: { sourceHits: true },
    });
  });

  app.post('/api/v1/recommendation/refresh', async () => {
    return refreshRecommendations();
  });

  app.post('/api/v1/recommendation/:id/dismiss', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return prisma.recommendation.update({ where: { id }, data: { dismissed: true } });
  });

  app.post('/api/v1/recommendation/:id/add', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = AddRecommendationBodySchema.parse(req.body);
    const recommendation = await prisma.recommendation.findUnique({ where: { id } });
    if (!recommendation) return reply.code(404).send({ error: 'Recommendation not found' });

    const artist = await prisma.artist.create({
      data: {
        name: recommendation.artistName,
        sortName: sortNameFor(recommendation.artistName),
        rootFolderId: body.rootFolderId,
        qualityProfileId: body.qualityProfileId,
      },
    });
    await prisma.artistSource.create({
      data: { artistId: artist.id, provider: 'recommendation', externalId: recommendation.mbid, origin: `recommendation:${id}` },
    });
    await prisma.recommendation.update({ where: { id }, data: { addedArtistId: artist.id } });
    reply.code(201);
    return artist;
  });
}

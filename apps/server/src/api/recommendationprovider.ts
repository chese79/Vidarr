import type { FastifyInstance } from 'fastify';
import { UpdateRecommendationProviderConfigSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';

export async function recommendationProviderRoutes(app: FastifyInstance) {
  app.get('/api/v1/recommendationprovider', async () => {
    return prisma.recommendationProviderConfig.findMany();
  });

  app.put('/api/v1/recommendationprovider/:provider', async (req) => {
    const provider = (req.params as { provider: string }).provider;
    const body = UpdateRecommendationProviderConfigSchema.parse(req.body);
    return prisma.recommendationProviderConfig.update({ where: { provider }, data: body });
  });
}

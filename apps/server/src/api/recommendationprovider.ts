import type { FastifyInstance } from 'fastify';
import { UpdateRecommendationProviderConfigSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';

export async function recommendationProviderRoutes(app: FastifyInstance) {
  app.get('/api/v1/recommendationprovider', async () => {
    return (await prisma.recommendationProviderConfig.findMany()).map(redactProvider);
  });

  app.put('/api/v1/recommendationprovider/:provider', async (req) => {
    const provider = (req.params as { provider: string }).provider;
    const body = UpdateRecommendationProviderConfigSchema.parse(req.body);
    return redactProvider(await prisma.recommendationProviderConfig.update({ where: { provider }, data: body }));
  });
}

function redactProvider<T extends { apiKey: string | null; clientSecret: string | null; accessToken: string | null }>(config: T) {
  const { apiKey, clientSecret, accessToken: _accessToken, ...safe } = config;
  return {
    ...safe,
    apiKey: null,
    clientSecret: null,
    hasApiKey: Boolean(apiKey),
    hasClientSecret: Boolean(clientSecret),
  };
}

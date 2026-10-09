import type { FastifyInstance } from 'fastify';
import { UpdateRecommendationProviderConfigSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { withLastFmLock } from '../pipeline/lastfmScrobbling.js';

export async function recommendationProviderRoutes(app: FastifyInstance) {
  app.get('/api/v1/recommendationprovider', async () => {
    return (await prisma.recommendationProviderConfig.findMany()).map(redactProvider);
  });

  app.put('/api/v1/recommendationprovider/:provider', async (req) => {
    const provider = (req.params as { provider: string }).provider;
    const body = UpdateRecommendationProviderConfigSchema.parse(req.body);
    const update = () => prisma.$transaction(async (tx) => {
      const previous = await tx.recommendationProviderConfig.findUnique({ where: { provider } });
      const updated = await tx.recommendationProviderConfig.update({ where: { provider }, data: body });
      if (provider === 'lastfm' && previous && (updated.apiKey !== previous.apiKey || updated.clientSecret !== previous.clientSecret)) {
        await tx.lastFmPlayback.deleteMany();
        await tx.lastFmAccount.deleteMany();
      }
      return redactProvider(updated);
    });
    return provider === 'lastfm' ? withLastFmLock(update) : update();
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

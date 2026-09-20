import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { isInstanceClaimable } from '../pipeline/auth.js';

// Lets the web UI show the freshly-generated API key directly on first load
// instead of requiring a trip to the server/container logs — but only while
// the instance is still "claimable" (see pipeline/auth.ts's
// isInstanceClaimable): before the key has ever authenticated a request,
// before an owner account has been created via POST /auth/setup, and only
// within a short window after generation. Once any of those is no longer
// true, this always 404s: the key is not retrievable through this route
// again, by design — same "shown once, never again" contract as a cloud
// provider's initial root credential.
export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/v1/setup/bootstrap-key', async (_req, reply) => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!isInstanceClaimable(settings)) {
      return reply.code(404).send({ error: 'Not available' });
    }
    return { apiKey: settings!.apiKey };
  });
}

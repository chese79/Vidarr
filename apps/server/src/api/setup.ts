import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { BOOTSTRAP_WINDOW_MS } from '../pipeline/auth.js';

// How long after generation the key stays revealable through this endpoint,
// even if nobody has logged in yet — bounds the exposure window for what is,
// by necessity, an unauthenticated route (see main.ts's onRequest hook,
// which exempts this path the same way it exempts /health).
// Lets the web UI show the freshly-generated API key directly on first load
// instead of requiring a trip to the server/container logs — but only
// before it's ever been used to log in, and only within a short window
// after generation. Once either condition is no longer true, this always
// 404s: the key is not retrievable through this route again, by design —
// same "shown once, never again" contract as a cloud provider's initial
// root credential.
export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/v1/setup/bootstrap-key', async (_req, reply) => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.apiKey || !settings.apiKeyGeneratedAt || settings.apiKeyFirstUsedAt) {
      return reply.code(404).send({ error: 'Not available' });
    }
    const age = Date.now() - settings.apiKeyGeneratedAt.getTime();
    if (age > BOOTSTRAP_WINDOW_MS) {
      return reply.code(404).send({ error: 'Not available' });
    }
    return { apiKey: settings.apiKey };
  });
}

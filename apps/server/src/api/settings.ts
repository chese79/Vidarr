import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { UpdateSettingsSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/v1/config', async () => {
    return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  });

  app.put('/api/v1/config', async (req) => {
    const body = UpdateSettingsSchema.parse(req.body);
    return prisma.settings.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, ...body },
    });
  });

  // Rotates vidarr's own API key. You have to already be authenticated to
  // call this (every /api/v1/* route requires the current key — see
  // main.ts's onRequest hook), so this is self-service rotation, not a
  // bootstrap mechanism. The new key is only ever generated server-side.
  app.post('/api/v1/config/regenerate-api-key', async () => {
    const apiKey = randomBytes(32).toString('hex');
    return prisma.settings.upsert({
      where: { id: 1 },
      update: { apiKey },
      create: { id: 1, apiKey },
    });
  });
}

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
}

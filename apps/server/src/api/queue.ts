import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { refreshQueue } from '../pipeline/grab.js';

export async function queueRoutes(app: FastifyInstance) {
  app.get('/api/v1/queue', async () => {
    return prisma.downloadQueueItem.findMany({
      include: { musicVideo: { include: { artist: true } } },
      orderBy: { addedAt: 'desc' },
    });
  });

  app.post('/api/v1/queue/refresh', async () => {
    return refreshQueue();
  });
}

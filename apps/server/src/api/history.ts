import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';

export async function historyRoutes(app: FastifyInstance) {
  app.get('/api/v1/history', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return prisma.history.findMany({
      orderBy: { date: 'desc' },
      take: limit,
      include: { musicVideo: { include: { artist: true } } },
    });
  });
}

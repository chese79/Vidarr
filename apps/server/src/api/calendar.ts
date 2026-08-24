import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';

// vidarr only stores a release *year* (IMVDb/YouTube don't reliably give a
// day-level music-video release date), so a true day-by-day release calendar
// isn't possible — this is "recently added, still wanted" ordered newest
// first, which is the closest honest equivalent for this domain.
export async function calendarRoutes(app: FastifyInstance) {
  app.get('/api/v1/calendar', async () => {
    return prisma.musicVideo.findMany({
      where: { monitored: true },
      orderBy: { addedAt: 'desc' },
      take: 50,
      include: { artist: true },
    });
  });
}

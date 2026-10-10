import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { refreshQueue } from '../pipeline/grab.js';
import { z } from 'zod';

export async function queueRoutes(app: FastifyInstance) {
  app.get('/api/v1/queue', async (req) => {
    const { activeOnly } = z.object({ activeOnly: z.enum(['true', 'false']).optional() }).parse(req.query);
    return prisma.downloadQueueItem.findMany({
      where: activeOnly === 'true' ? { status: { in: ['queued', 'downloading', 'importing', 'submissionUnknown'] } } : undefined,
      include: { musicVideo: { include: { artist: true } } },
      orderBy: { addedAt: 'desc' },
    });
  });

  for (const [section, eventType] of [['completed', 'downloadFolderImported'], ['failures', 'downloadFailed']] as const) {
    app.get(`/api/v1/queue/${section}`, async (req) => {
      const { page, pageSize } = z.object({
        page: z.coerce.number().int().min(1).max(1000000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      }).parse(req.query);
      const where = { eventType };
      const [total, items] = await prisma.$transaction([
        prisma.history.count({ where }),
        prisma.history.findMany({ where, orderBy: [{ date: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize, take: pageSize,
          include: { musicVideo: { include: { artist: true } } } }),
      ]);
      return { total, page, pageSize, items };
    });
  }

  app.post('/api/v1/queue/refresh', async () => {
    return refreshQueue();
  });
}

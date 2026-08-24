import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { runJobByName } from '../scheduler/index.js';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/v1/system/task', async () => {
    const tasks = await prisma.scheduledTask.findMany({ orderBy: { name: 'asc' } });
    return tasks.map((t) => ({
      ...t,
      nextRunAt: t.lastRunAt ? new Date(t.lastRunAt.getTime() + t.intervalMs).toISOString() : null,
    }));
  });

  app.post('/api/v1/system/task/:name/run', async (req, reply) => {
    const name = decodeURIComponent((req.params as { name: string }).name);
    try {
      await runJobByName(name);
      return { ok: true };
    } catch (err) {
      return reply.code(404).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/v1/log', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return prisma.activityLog.findMany({ orderBy: { date: 'desc' }, take: limit });
  });
}

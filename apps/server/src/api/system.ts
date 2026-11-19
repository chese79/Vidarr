import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { runJobByName, hasTask, rescheduleTask, isTaskRunning, supportsTaskContinuation } from '../scheduler/index.js';
import { UpdateTaskScheduleSchema } from '@vidarr/shared-types';
import { nextTaskRun } from '../scheduler/schedule.js';
import { regenerateAllLibraryMetadata } from '../pipeline/libraryConvention.js';
import { getNowPlaying } from '../pipeline/playbackMonitor.js';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/v1/system/now-playing', () => getNowPlaying());
  app.get('/api/v1/system/task', async () => {
    const tasks = await prisma.scheduledTask.findMany({ where: { name: { notIn: ['Qualified Playback Tracking', 'Live Qualified Playback'] } }, orderBy: { name: 'asc' } });
    return tasks.map((t) => ({
      ...t,
      running: isTaskRunning(t.name) || t.lastResult === 'running',
      supportsContinuation: supportsTaskContinuation(t.name),
      nextRunAt: !t.enabled ? null : t.nextRunAt?.toISOString() ?? (t.lastRunAt ? new Date(t.lastRunAt.getTime() + t.intervalMs).toISOString() : null),
    }));
  });

  app.put('/api/v1/system/task/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (!hasTask(name)) return reply.code(404).send({ error: 'Unknown scheduled task' });
    const parsed = UpdateTaskScheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map(issue => issue.message).join('; ') });
    const body = parsed.data;
    const current = await prisma.scheduledTask.findUnique({ where: { name } });
    if (!current) return reply.code(404).send({ error: 'Task has not been registered yet' });
    const schedule = { ...current, ...body, timeOfDay: body.scheduleType === 'daily' ? body.timeOfDay : null };
    const updated = await prisma.scheduledTask.update({ where: { name }, data: {
      scheduleType: schedule.scheduleType, intervalMs: schedule.intervalMs, timeOfDay: schedule.timeOfDay,
      timeZone: schedule.timeZone, enabled: body.enabled, nextRunAt: body.enabled ? nextTaskRun(schedule, new Date()) : null,
      windowStart: body.windowStart, windowEnd: body.windowEnd,
      continuePending: body.continuePending,
    } });
    await rescheduleTask(name);
    return { ...updated, supportsContinuation: supportsTaskContinuation(name), running: isTaskRunning(name) };
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

  app.post('/api/v1/system/regenerate-library-metadata', async () => {
    return regenerateAllLibraryMetadata();
  });

  app.get('/api/v1/log', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return prisma.activityLog.findMany({ orderBy: { date: 'desc' }, take: limit });
  });
}

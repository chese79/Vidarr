import { prisma, logActivity } from '../db/client.js';
import { JOBS } from './jobs.js';

const running = new Set<string>();

async function runJob(job: (typeof JOBS)[number]): Promise<void> {
  if (running.has(job.name)) return; // don't overlap a still-running instance of itself
  running.add(job.name);
  try {
    const message = await job.run();
    await prisma.scheduledTask.update({
      where: { name: job.name },
      data: { lastRunAt: new Date(), lastResult: 'success', lastError: null },
    });
    await logActivity('info', `job:${job.name}`, message);
  } catch (err) {
    await prisma.scheduledTask.update({
      where: { name: job.name },
      data: { lastRunAt: new Date(), lastResult: 'failed', lastError: (err as Error).message },
    });
    await logActivity('error', `job:${job.name}`, err);
  } finally {
    running.delete(job.name);
  }
}

export async function runJobByName(name: string): Promise<void> {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  await runJob(job);
}

export async function startScheduler(): Promise<void> {
  for (const job of JOBS) {
    const task = await prisma.scheduledTask.upsert({
      where: { name: job.name },
      update: {},
      create: { name: job.name, intervalMs: job.defaultIntervalMs },
    });
    setInterval(() => void runJob(job), task.intervalMs);
  }
}

import { prisma, logActivity } from '../db/client.js';
import { JOBS, type ScheduledJob } from './jobs.js';
import { sourceCollectionDue } from '../pipeline/artistVideoBackfill.js';
import { redactMessage } from '../security/redact.js';
import { withProviderPriority } from '../providers/metadata/requestScheduling.js';
import { nextTaskRun, fitTaskWindow, withinTaskWindow } from './schedule.js';
import type { ScheduledTask } from '@prisma/client';

const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const continuations = new Map<string, ReturnType<typeof setTimeout>>();
const revisions = new Map<string, number>();
let epoch = 0;
let started = false;
export const isTaskRunning = (name: string) => running.has(name);
export const hasTask = (name: string) => JOBS.some(job => job.name === name);
export const supportsTaskContinuation = (name: string) => JOBS.some(job => job.name === name && (job.rerun || job.name === 'Artist Video Inventory Backfill'));
function report(error: unknown) { console.error('Scheduler:', redactMessage(error)); }
function usesDefaultInterval(job: ScheduledJob, task: ScheduledTask) {
  return task.enabled && task.scheduleType === 'interval' && task.intervalMs === job.defaultIntervalMs;
}
function clearContinuation(name: string) {
  const timer = continuations.get(name);
  if (timer) clearTimeout(timer);
  continuations.delete(name);
}

async function runJob(job: ScheduledJob): Promise<void> {
  if (running.has(job.name)) return;
  running.add(job.name);
  try {
    await prisma.scheduledTask.update({ where: { name: job.name }, data: { lastResult: 'running', lastError: null } });
    const message = await withProviderPriority(job.name === 'Music Video Metadata Enrichment' ? 'enrichment' : 'background', () => job.run());
    await prisma.scheduledTask.update({ where: { name: job.name }, data: { lastRunAt: new Date(), lastResult: 'success', lastError: null } });
    await logActivity('info', `job:${job.name}`, message);
  } catch (error) {
    await prisma.scheduledTask.update({ where: { name: job.name }, data: { lastRunAt: new Date(), lastResult: 'failed', lastError: redactMessage(error) } });
    await logActivity('error', `job:${job.name}`, error);
  } finally {
    running.delete(job.name);
    if (started && process.env.NODE_ENV === 'production') {
      const task = await prisma.scheduledTask.findUnique({ where: { name: job.name } });
      if (started && task?.enabled && task.continuePending && withinTaskWindow(task, new Date())) {
        const pending = job.rerun?.() || (job.name === 'Artist Video Inventory Backfill'
          && await prisma.artist.count({ where: sourceCollectionDue() }) > 0);
        if (started && pending) {
          clearContinuation(job.name);
          continuations.set(job.name, setTimeout(() => {
            continuations.delete(job.name);
            void (async () => {
              const current = await prisma.scheduledTask.findUnique({ where: { name: job.name } });
              if (started && current?.enabled && current.continuePending && withinTaskWindow(current, new Date())) await runJob(job);
            })().catch(report);
          }, 1000));
        }
      }
    }
  }
}

function arm(task: ScheduledTask) {
  const previous = timers.get(task.name);
  if (previous) clearTimeout(previous);
  timers.delete(task.name);
  if (!started || !task.enabled || !task.nextRunAt) return;
  const delay = Math.min(2_147_483_647, Math.max(1, task.nextRunAt.getTime() - Date.now()));
  const timer = setTimeout(() => {
    if (!started || timers.get(task.name) !== timer) return;
    timers.delete(task.name);
    void scheduledRun(task.name).catch(report);
  }, delay);
  timers.set(task.name, timer);
}

async function scheduledRun(name: string) {
  const executionEpoch = epoch;
  const job = JOBS.find(value => value.name === name);
  const task = await prisma.scheduledTask.findUnique({ where: { name } });
  if (!started || executionEpoch !== epoch || !job || !task?.enabled || !task.nextRunAt) return;
  const now = new Date();
  if (task.nextRunAt > now) { await rescheduleTask(name); return; }
  if (!withinTaskWindow(task, now)) {
    await prisma.scheduledTask.updateMany({ where: { id: task.id, nextRunAt: task.nextRunAt, enabled: true }, data: { nextRunAt: fitTaskWindow(task, now) } });
    await rescheduleTask(name); return;
  }
  const nextRunAt = nextTaskRun(task, now);
  const overlapping = running.has(name);
  // Do not overwrite a schedule edited while this callback was reading it.
  const claimed = await prisma.scheduledTask.updateMany({ where: { id: task.id, enabled: true, nextRunAt: task.nextRunAt },
    data: { nextRunAt, ...(!overlapping ? { lastResult: 'running', lastError: null } : {}) } });
  if (!claimed.count) { await rescheduleTask(name); return; }
  if (!started || executionEpoch !== epoch) return; // Persisted claim is recovered after restart.
  if (overlapping) { await rescheduleTask(name); return; }
  const execution = runJob(job);
  await Promise.all([rescheduleTask(name), execution]);
}

export async function rescheduleTask(name: string): Promise<void> {
  clearContinuation(name);
  const revision = (revisions.get(name) ?? 0) + 1;
  revisions.set(name, revision);
  const currentEpoch = epoch;
  const task = await prisma.scheduledTask.findUnique({ where: { name } });
  if (task && currentEpoch === epoch && revisions.get(name) === revision) arm(task);
}

export async function runJobByName(name: string): Promise<void> {
  const job = JOBS.find(value => value.name === name);
  if (!job) throw Error(`Unknown job: ${name}`);
  await runJob(job);
}

export function stopScheduler(): void {
  started = false;
  epoch++;
  for (const timer of timers.values()) clearTimeout(timer);
  for (const timer of continuations.values()) clearTimeout(timer);
  timers.clear(); continuations.clear();
}

export async function startScheduler(): Promise<void> {
  stopScheduler();
  started = true;
  for (const job of JOBS) {
    let task = await prisma.scheduledTask.upsert({ where: { name: job.name }, update: {},
      create: { name: job.name, intervalMs: job.defaultIntervalMs, ...job.defaultSchedule, ...job.defaultWindow } });
    if (task.lastResult === 'running' && !running.has(job.name)) {
      task = await prisma.scheduledTask.update({ where: { id: task.id }, data: {
        lastResult: 'failed', lastError: 'Interrupted by restart; retry at the next permitted time.',
        nextRunAt: task.enabled ? fitTaskWindow(task, new Date(Date.now() + 1000)) : null,
      } });
    }
    if (job.name === 'Library Sync' && task.enabled && await prisma.libraryConnector.count({ where: {
      enabled: true, lastSyncError: { startsWith: 'Library sync interrupted by restart;' },
    } })) task = await prisma.scheduledTask.update({ where: { id: task.id }, data: { nextRunAt: fitTaskWindow(task, new Date(Date.now() + 1000)) } });
    if (task.enabled && !task.nextRunAt) {
      const eagerFirstRun = !task.lastRunAt && usesDefaultInterval(job, task)
        && ['Artist Video Inventory Backfill', 'Artist Genre Backfill', 'Existing Artist Source Discovery', 'Playback Monitor'].includes(job.name);
      const nextRunAt = eagerFirstRun ? new Date(Date.now() + 1) : task.scheduleType === 'interval' && task.lastRunAt
        ? new Date(Math.max(Date.now() + 1, task.lastRunAt.getTime() + task.intervalMs)) : nextTaskRun(task, new Date());
      task = await prisma.scheduledTask.update({ where: { id: task.id }, data: { nextRunAt: fitTaskWindow(task, nextRunAt) } });
    }
    await rescheduleTask(job.name);
  }
}

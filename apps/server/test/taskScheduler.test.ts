import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb } from './support/db.js';
const work = vi.hoisted(() => ({ interval: vi.fn(async () => 'done'), daily: vi.fn(async () => 'done'), background: vi.fn(async () => 'done') }));
vi.mock('../src/scheduler/jobs.js', () => ({ JOBS: [
  { name: 'Interval Example', defaultIntervalMs: 60_000, run: work.interval },
  { name: 'Daily Example', defaultIntervalMs: 86_400_000, defaultSchedule: { scheduleType: 'daily', timeOfDay: '03:00', timeZone: 'America/Chicago' }, defaultWindow: { windowStart: '02:00', windowEnd: '10:00' }, run: work.daily },
  { name: 'Background Example', defaultIntervalMs: 15_000, defaultWindow: { windowStart: '02:00', windowEnd: '10:00' }, run: work.background, rerun: () => true },
] }));
import { startScheduler, stopScheduler, rescheduleTask, runJobByName, isTaskRunning } from '../src/scheduler/index.js';
import { nextTaskRun } from '../src/scheduler/schedule.js';

beforeEach(async () => { stopScheduler(); await resetDb(); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(new Date('2026-11-19T08:00:00Z')); });
afterEach(async () => { stopScheduler(); await vi.waitFor(() => expect(['Interval Example', 'Daily Example', 'Background Example'].some(isTaskRunning)).toBe(false)); vi.useRealTimers(); vi.unstubAllEnvs(); });

it('reschedules a changed interval immediately and cancels its old timer', async () => {
  await startScheduler(); await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(work.interval).toHaveBeenCalledTimes(1));
  const row = await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Interval Example' } });
  const changed = { ...row, intervalMs: 120_000 };
  await prisma.scheduledTask.update({ where: { id: row.id }, data: { intervalMs: 120_000, nextRunAt: nextTaskRun(changed, new Date()) } });
  await rescheduleTask(row.name);
  await vi.advanceTimersByTimeAsync(119_000); expect(work.interval).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000); await vi.waitFor(() => expect(work.interval).toHaveBeenCalledTimes(2));
});

it('preserves a daily deadline across scheduler restarts and runs once at 3 a.m.', async () => {
  vi.setSystemTime(new Date('2026-11-19T08:59:55Z')); await startScheduler();
  const before = await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Daily Example' } });
  expect(before.nextRunAt!.toISOString()).toBe('2026-11-19T09:00:00.000Z');
  stopScheduler(); await startScheduler();
  expect((await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Daily Example' } })).nextRunAt).toEqual(before.nextRunAt);
  await vi.advanceTimersByTimeAsync(5000); await vi.waitFor(() => expect(work.daily).toHaveBeenCalledTimes(1));
  expect((await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Daily Example' } })).nextRunAt!.toISOString()).toBe('2026-11-20T09:00:00.000Z');
});

it('keeps automatic work out of the daytime window while allowing explicit Run Now', async () => {
  vi.setSystemTime(new Date('2026-11-19T18:00:00Z')); await startScheduler();
  const row = await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Background Example' } });
  expect(row.nextRunAt!.toISOString()).toBe('2026-11-20T08:00:00.000Z');
  await vi.advanceTimersByTimeAsync(60_000); expect(work.background).not.toHaveBeenCalled();
  await runJobByName(row.name); expect(work.background).toHaveBeenCalledOnce();
});

it('disabling a task cancels future automatic executions', async () => {
  await startScheduler();
  await prisma.scheduledTask.update({ where: { name: 'Interval Example' }, data: { enabled: false, nextRunAt: null } });
  await rescheduleTask('Interval Example');
  await vi.advanceTimersByTimeAsync(120_000); expect(work.interval).not.toHaveBeenCalled();
  await runJobByName('Interval Example'); expect(work.interval).toHaveBeenCalledOnce();
});

it('never overlaps a long-running task when another interval becomes due', async () => {
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  work.interval.mockImplementationOnce(async () => { await blocked; return 'done'; });
  try {
    await startScheduler(); await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(work.interval).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60_000); expect(work.interval).toHaveBeenCalledOnce();
  } finally { finish(); }
  await vi.waitFor(() => expect(isTaskRunning('Interval Example')).toBe(false));
  expect((await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Interval Example' } })).lastResult).toBe('success');
});

it('honors the keep-working switch for follow-up work inside its window', async () => {
  vi.stubEnv('NODE_ENV', 'production'); await startScheduler();
  await runJobByName('Background Example'); expect(work.background).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000); await vi.waitFor(() => expect(work.background).toHaveBeenCalledTimes(2));
  await prisma.scheduledTask.update({ where: { name: 'Background Example' }, data: { scheduleType: 'daily', timeOfDay: '03:00', continuePending: false, nextRunAt: new Date('2026-11-19T09:00:00Z') } });
  await rescheduleTask('Background Example');
  await vi.advanceTimersByTimeAsync(5000); expect(work.background).toHaveBeenCalledTimes(2);
});

it('retries an interrupted task only at its next permitted window', async () => {
  vi.setSystemTime(new Date('2026-11-19T18:00:00Z'));
  await prisma.scheduledTask.create({ data: { name: 'Daily Example', intervalMs: 86_400_000, scheduleType: 'daily', timeOfDay: '03:00',
    timeZone: 'America/Chicago', windowStart: '02:00', windowEnd: '10:00', lastResult: 'running', nextRunAt: new Date('2026-11-20T09:00:00Z') } });
  await startScheduler();
  const recovered = await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Daily Example' } });
  expect(recovered.lastResult).toBe('failed'); expect(recovered.lastError).toContain('Interrupted');
  expect(recovered.nextRunAt!.toISOString()).toBe('2026-11-20T08:00:00.000Z'); expect(work.daily).not.toHaveBeenCalled();
});

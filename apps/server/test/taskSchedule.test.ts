import { describe, expect, it } from 'vitest';
import { nextTaskRun, withinTaskWindow, fitTaskWindow } from '../src/scheduler/schedule.js';
import { UpdateTaskScheduleSchema } from '@vidarr/shared-types';

const daily = { scheduleType: 'daily', intervalMs: 86_400_000, timeOfDay: '03:00', timeZone: 'America/Chicago' };
describe('editable task scheduling', () => {
  it.each([
    ['2026-11-19T07:00:00Z', '2026-11-19T09:00:00.000Z'],
    ['2026-07-10T07:00:00Z', '2026-07-10T08:00:00.000Z'],
    ['2026-11-19T09:00:00Z', '2026-11-20T09:00:00.000Z'],
    ['2026-03-08T07:00:00Z', '2026-03-08T08:00:00.000Z'],
    ['2026-11-01T05:00:00Z', '2026-11-01T09:00:00.000Z'],
  ])('schedules local 3 a.m. from %s', (now, expected) => {
    expect(nextTaskRun(daily, new Date(now)).toISOString()).toBe(expected);
  });
  it('runs a missing spring-forward time at the first valid minute', () => {
    expect(nextTaskRun({ ...daily, timeOfDay: '02:30' }, new Date('2026-03-08T07:00:00Z')).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });
  it('advances to tomorrow after the first occurrence of a repeated hour', () => {
    const schedule = { ...daily, timeOfDay: '01:30' };
    const first = nextTaskRun(schedule, new Date('2026-11-01T05:00:00Z'));
    expect(first.toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(nextTaskRun(schedule, first).toISOString()).toBe('2026-11-02T07:30:00.000Z');
  });
  it('uses an explicitly selected zone rather than the process clock zone', () => {
    expect(nextTaskRun({ ...daily, timeZone: 'Asia/Tokyo' }, new Date('2026-11-18T19:00:00Z')).toISOString()).toBe('2026-11-19T18:00:00.000Z');
  });
  const windowed = { ...daily, scheduleType: 'interval', intervalMs: 60_000, windowStart: '02:00', windowEnd: '10:00' };
  it('defers work to the window opening and excludes the closing boundary', () => {
    expect(nextTaskRun(windowed, new Date('2026-11-19T06:00:00Z')).toISOString()).toBe('2026-11-19T08:00:00.000Z');
    expect(withinTaskWindow(windowed, new Date('2026-11-19T08:00:00Z'))).toBe(true);
    expect(withinTaskWindow(windowed, new Date('2026-11-19T16:00:00Z'))).toBe(false);
    expect(nextTaskRun(windowed, new Date('2026-11-19T15:59:30Z')).toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(fitTaskWindow(windowed, new Date('2026-11-19T09:05:00Z')).toISOString()).toBe('2026-11-19T09:05:00.000Z');
  });
  it('supports automatic windows spanning midnight', () => {
    const overnight = { ...windowed, windowStart: '22:00', windowEnd: '06:00' };
    expect(withinTaskWindow(overnight, new Date('2026-11-19T05:00:00Z'))).toBe(true);
    expect(withinTaskWindow(overnight, new Date('2026-11-19T10:00:00Z'))).toBe(true);
    expect(nextTaskRun(overnight, new Date('2026-11-19T15:00:00Z')).toISOString()).toBe('2026-11-20T04:00:00.000Z');
  });
  it('validates supported timing, frequency, time zone and window combinations', () => {
    expect(UpdateTaskScheduleSchema.parse({ scheduleType: 'interval', intervalMs: 15_000, enabled: true }).windowStart).toBeNull();
    expect(UpdateTaskScheduleSchema.safeParse({ scheduleType: 'daily', timeOfDay: '03:00', timeZone: 'America/Chicago', enabled: true, windowStart: '02:00', windowEnd: '10:00' }).success).toBe(true);
    for (const patch of [
      { scheduleType: 'interval', intervalMs: 0 }, { scheduleType: 'interval', intervalMs: 3_000_000_000 },
      { scheduleType: 'daily', timeOfDay: '25:00' }, { scheduleType: 'daily', timeOfDay: '03:00', timeZone: 'invalid/zone' },
      { scheduleType: 'daily', timeOfDay: '11:00', windowStart: '02:00', windowEnd: '10:00' },
      { scheduleType: 'daily', timeOfDay: '03:00', windowStart: '02:00', windowEnd: null },
      { scheduleType: 'daily', timeOfDay: '03:00', windowStart: '02:00', windowEnd: '02:00' },
    ]) expect(UpdateTaskScheduleSchema.safeParse({ enabled: true, timeZone: 'America/Chicago', ...patch }).success).toBe(false);
  });
});

export interface TaskSchedule {
  scheduleType: string;
  intervalMs: number;
  timeOfDay: string | null;
  timeZone: string;
  windowStart?: string | null;
  windowEnd?: string | null;
}

export function nextTaskRun(schedule: TaskSchedule, now: Date): Date {
  const next = schedule.scheduleType === 'interval' ? new Date(now.getTime() + schedule.intervalMs)
    : nextDailyTime(now, schedule.timeOfDay!, schedule.timeZone);
  return fitTaskWindow(schedule, next);
}

function localParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
}

export function withinTaskWindow(schedule: TaskSchedule, now: Date): boolean {
  if (!schedule.windowStart || !schedule.windowEnd) return true;
  const p = localParts(now, schedule.timeZone);
  const time = `${p.hour}:${p.minute}`;
  return schedule.windowStart < schedule.windowEnd ? time >= schedule.windowStart && time < schedule.windowEnd
    : time >= schedule.windowStart || time < schedule.windowEnd;
}

export function fitTaskWindow(schedule: TaskSchedule, date: Date): Date {
  return withinTaskWindow(schedule, date) ? date : nextDailyTime(date, schedule.windowStart!, schedule.timeZone);
}

function nextDailyTime(now: Date, timeOfDay: string, timeZone: string): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) throw Error('Invalid daily time');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const local = parts(now);
  const day = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  if (`${local.hour}:${local.minute}` >= timeOfDay) day.setUTCDate(day.getUTCDate() + 1);
  const dateKey = day.toISOString().slice(0, 10);
  // Search real instants, avoiding invented offsets at DST gaps and folds.
  // A missing wall time runs at the first valid minute after it. Persisting
  // the next date before execution prevents a repeated fall-back hour running twice.
  for (let offset = -18 * 60; offset < 42 * 60; offset++) {
    const candidate = new Date(day.getTime() + offset * 60_000);
    if (candidate <= now) continue;
    const p = parts(candidate);
    if (`${p.year}-${p.month}-${p.day}` === dateKey && `${p.hour}:${p.minute}` >= timeOfDay) return candidate;
  }
  throw Error('Could not resolve the next daily run');
}

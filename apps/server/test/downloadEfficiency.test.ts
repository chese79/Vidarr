import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { progressLines } from '../src/providers/youtube/ytdlp.js';
import { processDeadline } from '../src/pipeline/processDeadline.js';
import { withValidationWorker } from '../src/pipeline/validationWorker.js';

afterEach(() => vi.useRealTimers());

it('reads split, batched and final unterminated progress lines', () => {
  const values: number[] = [];
  const parse = progressLines(value => values.push(value));
  parse('[down'); parse('load] 12.5%\n[download] 55%\n[download] 100%'); parse('', true);
  expect(values).toEqual([.125, .55, 1]);
});

it('terminates a hung child, escalates termination and clears completed deadlines', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const reject = vi.fn();
  processDeadline(child as unknown as ChildProcess, 1000, 'Test process', reject);
  await vi.advanceTimersByTimeAsync(1000);
  expect(reject.mock.calls[0][0].message).toContain('timed out');
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  await vi.advanceTimersByTimeAsync(5000);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  const completed = Object.assign(new EventEmitter(), { kill: vi.fn() });
  processDeadline(completed as unknown as ChildProcess, 1000, 'Complete', reject);
  completed.emit('close', 0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(completed.kill).not.toHaveBeenCalled();
});

it('runs one validation at a time and releases the worker after a failure', async () => {
  let release!: () => void;
  const events: string[] = [];
  const first = withValidationWorker(async () => { events.push('first'); await new Promise<void>(resolve => { release = resolve; }); throw new Error('bad file'); });
  const failed = expect(first).rejects.toThrow('bad file');
  const second = withValidationWorker(async () => { events.push('second'); return 42; });
  await Promise.resolve();
  expect(events).toEqual(['first']);
  release(); await failed;
  expect(await second).toBe(42);
  expect(events).toEqual(['first', 'second']);
});

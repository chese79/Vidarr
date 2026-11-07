import { afterEach, expect, it, vi } from 'vitest';
import { FairRequestQueue, JsonRequestCache, withProviderPriority } from '../src/providers/metadata/requestScheduling.js';
afterEach(() => vi.useRealTimers());

it('serves interactive work promptly while giving enrichment and maintenance bounded turns', async () => {
  const queue = new FairRequestQueue(0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.enqueue(() => gate);
  const order: string[] = [];
  const submit = (name: string, priority: 'interactive' | 'enrichment' | 'background') => withProviderPriority(priority, () => queue.enqueue(async () => { order.push(name); }));
  const jobs = [submit('background', 'background'), submit('enrich1', 'enrichment'), submit('enrich2', 'enrichment'), submit('enrich3', 'enrichment'), submit('user', 'interactive')];
  release(); await Promise.all([first, ...jobs]);
  expect(order).toEqual(['enrich1', 'enrich2', 'background', 'user', 'enrich3']);
});

it('retains request spacing and releases the lane after a failed request', async () => {
  vi.useFakeTimers();
  const queue = new FairRequestQueue(1100);
  const calls: number[] = [];
  const first = queue.enqueue(async () => { calls.push(Date.now()); throw Error('outage'); }).catch(() => undefined);
  const second = queue.enqueue(async () => { calls.push(Date.now()); });
  await vi.runAllTimersAsync(); await Promise.all([first, second]);
  expect(calls).toHaveLength(2); expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1100);
});

it('coalesces identical requests and returns independent cached objects', async () => {
  const cache = new JsonRequestCache();
  const load = vi.fn(async () => ({ names: ['original'] }));
  const [one, two] = await Promise.all([cache.get('release', load), cache.get('release', load)]);
  one.names.push('edited');
  expect(two.names).toEqual(['original']); expect((await cache.get('release', load)).names).toEqual(['original']);
  expect(load).toHaveBeenCalledTimes(1);
});

it('counts slow response time toward spacing without overlapping requests', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const queue = new FairRequestQueue(1100), starts: number[] = [];
  let active = 0, maxActive = 0;
  const work = async () => {
    starts.push(Date.now()); maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setTimeout(resolve, 2000)); active--;
  };
  const jobs = [queue.enqueue(work), queue.enqueue(work)];
  await vi.runAllTimersAsync(); await Promise.all(jobs);
  expect(starts).toEqual([0, 2000]); expect(maxActive).toBe(1);
});

it('selects priority after the spacing wait, including new interactive arrivals', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const queue = new FairRequestQueue(1100), order: string[] = [];
  const first = queue.enqueue(async () => {}, 'background');
  await first;
  const background = queue.enqueue(async () => { order.push('background'); }, 'background');
  await vi.advanceTimersByTimeAsync(500);
  const interactive = queue.enqueue(async () => { order.push('interactive'); }, 'interactive');
  await vi.runAllTimersAsync(); await Promise.all([background, interactive]);
  expect(order).toEqual(['interactive', 'background']);
});

it('expires successes, bounds memory, and never caches a failed request as empty data', async () => {
  vi.useFakeTimers();
  const cache = new JsonRequestCache(100, 1, 128);
  const load = vi.fn(async () => ({ value: 1 }));
  await cache.get('a', load); await cache.get('b', load); await cache.get('a', load);
  expect(load).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(101); await cache.get('a', load);
  expect(load).toHaveBeenCalledTimes(4);
  const oversized = vi.fn(async () => ({ value: 'x'.repeat(256) }));
  await cache.get('big', oversized); await cache.get('big', oversized); expect(oversized).toHaveBeenCalledTimes(2);
  await expect(cache.get('bad', async () => { throw Error('503'); })).rejects.toThrow('503');
  expect(await cache.get('bad', load)).toEqual({ value: 1 });
});

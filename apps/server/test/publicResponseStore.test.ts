import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicResponseStore } from '../src/providers/metadata/publicResponseStore.js';
import { JsonRequestCache } from '../src/providers/metadata/requestScheduling.js';
const folders: string[] = [];
async function folder() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-public-cache-')); folders.push(value); return value; }
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

it('reuses successful public responses after restart with original observation time and isolated consumers', async () => {
  const directory = await folder();
  const load = vi.fn(async () => ({ body: { album: ['original'] }, observedAt: '2026-11-06T00:00:00Z' }));
  const first = new JsonRequestCache(60000, 2, 4096, new PublicResponseStore(directory));
  await first.get('/release/one', load);
  const restarted = new JsonRequestCache(60000, 2, 4096, new PublicResponseStore(directory));
  const [one, two] = await Promise.all([restarted.get('/release/one', load), restarted.get('/release/one', load)]);
  one.body.album.push('edited');
  expect(two).toEqual({ body: { album: ['original'] }, observedAt: '2026-11-06T00:00:00Z' });
  expect(load).toHaveBeenCalledTimes(1);
});

it('expires disk entries across restart without extending their lifetime on a hit', async () => {
  const directory = await folder(); vi.useFakeTimers();
  const load = vi.fn(async () => ({ count: 1 }));
  await new JsonRequestCache(100, 2, 4096, new PublicResponseStore(directory)).get('a', load);
  await vi.advanceTimersByTimeAsync(80);
  const second = new JsonRequestCache(100, 2, 4096, new PublicResponseStore(directory));
  await second.get('a', load);
  await vi.advanceTimersByTimeAsync(21); await second.get('a', load);
  expect(load).toHaveBeenCalledTimes(2);
});

it('bounds serialized disk size and entry count, including on restart', async () => {
  const directory = await folder();
  const store = new PublicResponseStore(directory, 2, 300);
  for (const key of ['a', 'b', 'c']) await store.set(key, JSON.stringify({ value: 'data' }), Date.now() + 60000);
  expect(await store.get('a')).toBeUndefined();
  const files = await fs.readdir(directory);
  expect(files).toHaveLength(2);
  expect((await Promise.all(files.map(file => fs.stat(path.join(directory, file))))).reduce((n, stat) => n + stat.size, 0)).toBeLessThanOrEqual(300);
  const restarted = new PublicResponseStore(directory, 1, 300);
  await restarted.get('c'); expect(await fs.readdir(directory)).toHaveLength(1);
  await restarted.set('huge', JSON.stringify('x'.repeat(400)), Date.now() + 60000);
  expect(await restarted.get('huge')).toBeUndefined();
});

it('discards corrupt cache data and interrupted writes, and does not persist provider failures', async () => {
  const directory = await folder(), store = new PublicResponseStore(directory);
  const first = new JsonRequestCache(60000, 2, 4096, store);
  await expect(first.get('bad', async () => { throw Error('503'); })).rejects.toThrow('503');
  expect(await fs.readdir(directory)).toEqual([]);
  await store.set('good', '{}', Date.now() + 60000);
  const [file] = await fs.readdir(directory); await fs.writeFile(path.join(directory, file), 'bad json');
  await fs.writeFile(path.join(directory, '1234-abcd.tmp'), 'partial');
  const load = vi.fn(async () => ({ restored: true }));
  expect(await new JsonRequestCache(60000, 2, 4096, new PublicResponseStore(directory)).get('good', load)).toEqual({ restored: true });
  expect(load).toHaveBeenCalledTimes(1); expect((await fs.readdir(directory)).every(file => file.endsWith('.json'))).toBe(true);
});

it('keeps enrichment available when the disk cache is unwritable', async () => {
  const directory = await folder(), blocked = path.join(directory, 'file'); await fs.writeFile(blocked, 'occupied');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cache = new JsonRequestCache(60000, 2, 4096, new PublicResponseStore(blocked));
  expect(await cache.get('a', async () => ({ okay: true }))).toEqual({ okay: true });
  expect(console.warn).toHaveBeenCalledTimes(1);
});

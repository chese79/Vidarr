import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stageImportBundle } from '../src/pipeline/importBundle.js';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-move-efficiency-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
const metadata = { artistName: 'Artist', title: 'Song', year: null, director: null, thumbnailUrl: null };

it('stages move imports without copying video bytes, retaining source until commit', async () => {
  const source = path.join(directory, 'source.mp4'), destination = path.join(directory, 'library', 'song.mp4');
  await fs.writeFile(source, 'video');
  const bundle = await stageImportBundle(source, destination, 'move', metadata);
  expect((await fs.stat(destination)).ino).toBe((await fs.stat(source)).ino);
  await bundle.commit();
  await expect(fs.access(source)).rejects.toThrow();
  expect(await fs.readFile(destination, 'utf8')).toBe('video');
});

it('restores an existing video on rollback and preserves the new source', async () => {
  const source = path.join(directory, 'source.mp4'), destination = path.join(directory, 'song.mp4');
  await fs.writeFile(source, 'new'); await fs.writeFile(destination, 'old');
  const bundle = await stageImportBundle(source, destination, 'move', metadata);
  await bundle.rollback();
  expect(await fs.readFile(destination, 'utf8')).toBe('old');
  expect(await fs.readFile(source, 'utf8')).toBe('new');
});

it('uses a safe copy across filesystems while still retaining rollback', async () => {
  const source = path.join(directory, 'source.mp4'), destination = path.join(directory, 'song.mp4');
  await fs.writeFile(source, 'video');
  vi.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('cross device'), { code: 'EXDEV' }));
  const bundle = await stageImportBundle(source, destination, 'move', metadata);
  expect((await fs.stat(destination)).ino).not.toBe((await fs.stat(source)).ino);
  await bundle.rollback();
  expect(await fs.readFile(source, 'utf8')).toBe('video');
  await expect(fs.access(destination)).rejects.toThrow();
});

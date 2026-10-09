import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { placeFile, replaceFile, stageFileReplacement } from '../src/pipeline/transfer.js';

describe('placeFile', () => {
  let tmpDir: string;
  let sourcePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-transfer-test-'));
    sourcePath = path.join(tmpDir, 'source.mp4');
    await fs.writeFile(sourcePath, 'fake video bytes');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('copy mode leaves the source in place and creates the destination', async () => {
    const destPath = path.join(tmpDir, 'nested', 'dest.mp4');
    await placeFile(sourcePath, destPath, 'copy');

    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('fake video bytes');
    await expect(fs.readFile(sourcePath, 'utf-8')).resolves.toBe('fake video bytes');
  });

  it('move mode removes the source after placing the destination', async () => {
    const destPath = path.join(tmpDir, 'dest.mp4');
    await placeFile(sourcePath, destPath, 'move');

    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('fake video bytes');
    await expect(fs.access(sourcePath)).rejects.toThrow();
  });

  it('hardlink mode creates a link that shares the same file', async () => {
    const destPath = path.join(tmpDir, 'dest.mp4');
    await placeFile(sourcePath, destPath, 'hardlink');

    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('fake video bytes');
    const sourceStat = await fs.stat(sourcePath);
    const destStat = await fs.stat(destPath);
    expect(destStat.ino).toBe(sourceStat.ino);
  });

  it('creates intermediate destination directories that do not yet exist', async () => {
    const destPath = path.join(tmpDir, 'a', 'b', 'c', 'dest.mp4');
    await placeFile(sourcePath, destPath, 'copy');
    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('fake video bytes');
  });

  it('replaces an existing destination in hardlink mode without EEXIST', async () => {
    const destPath = path.join(tmpDir, 'dest.mp4');
    await fs.writeFile(destPath, 'old video bytes');

    await replaceFile(sourcePath, destPath, 'hardlink');

    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('fake video bytes');
    const sourceStat = await fs.stat(sourcePath);
    const destStat = await fs.stat(destPath);
    expect(destStat.ino).toBe(sourceStat.ino);
  });

  it('restores the source and original library file for a failed cross-filesystem move', async () => {
    const destPath = path.join(tmpDir, 'dest.mp4');
    await fs.writeFile(destPath, 'old video bytes');
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === sourcePath || to === sourcePath) {
        throw Object.assign(new Error('cross-device move'), { code: 'EXDEV' });
      }
      return rename(from, to);
    });
    const replacement = await stageFileReplacement(sourcePath, destPath, 'move');
    await expect(fs.access(sourcePath)).rejects.toThrow();
    await replacement.rollback();
    await expect(fs.readFile(destPath, 'utf-8')).resolves.toBe('old video bytes');
    await expect(fs.readFile(sourcePath, 'utf-8')).resolves.toBe('fake video bytes');
  });
});

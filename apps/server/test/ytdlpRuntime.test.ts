import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveYoutubeCookies } from '../src/providers/youtube/cookies.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { downloadDirectVideo, getVideoMetadata } from '../src/providers/youtube/ytdlp.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function mockProcess(stdout: string, stderr = '', code = 0) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
  });
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
    });
    return child as ReturnType<typeof spawn>;
  });
}

beforeEach(() => vi.clearAllMocks());

it('enables the running Node executable for metadata extraction and direct downloads', async () => {
  mockProcess(JSON.stringify({ title: 'Song', channel: 'Artist' }));
  expect(await getVideoMetadata('video-id')).toMatchObject({ title: 'Song' });
  mockProcess('/tmp/video.mp4\n');
  expect(await downloadDirectVideo('https://www.youtube.com/watch?v=video-id', '/tmp'))
    .toBe('/tmp/video.mp4');
  for (const [, args] of vi.mocked(spawn).mock.calls) {
    expect(args?.slice(0, 2)).toEqual(['--js-runtimes', `node:${process.execPath}`]);
  }
  expect(vi.mocked(spawn).mock.calls[1][1]).toContain('--progress');
});

it('reports the private-video error without preceding runtime warnings', async () => {
  mockProcess('', 'WARNING: No supported JavaScript runtime\nSee runtime setup documentation\nERROR: [youtube] video-id: Private video\n', 1);
  await expect(downloadDirectVideo('https://www.youtube.com/watch?v=video-id', '/tmp'))
    .rejects.toThrow(/^yt-dlp download failed: ERROR: \[youtube\] video-id: Private video$/);
});

it('passes saved cookies for YouTube only and cleans snapshots after extractor failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vidarr-runtime-test-'));
  vi.stubEnv('DATABASE_URL', `file:${path.join(directory, 'test.db')}`);
  try {
    await saveYoutubeCookies('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n');
    mockProcess('', 'ERROR: Private video', 1);
    await expect(getVideoMetadata('private')).rejects.toThrow('Private video');
    const args = vi.mocked(spawn).mock.calls[0][1]!;
    expect(args).toContain('--cookies');
    await expect(stat(args[args.indexOf('--cookies') + 1])).rejects.toMatchObject({ code: 'ENOENT' });
    mockProcess('/tmp/video.mp4\n');
    await downloadDirectVideo('https://vimeo.com/1', '/tmp');
    expect(vi.mocked(spawn).mock.calls[1][1]).not.toContain('--cookies');
  } finally { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
});

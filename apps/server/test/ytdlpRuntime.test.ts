import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { beforeEach, expect, it, vi } from 'vitest';
import { downloadDirectVideo, getVideoMetadata } from '../src/providers/youtube/ytdlp.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function mockProcess(stdout: string, stderr = '', code = 0) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as ReturnType<typeof spawn>);
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
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

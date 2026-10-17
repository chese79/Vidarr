import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { assertIsRealMusicVideo } from '../src/pipeline/validateVideoFile.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
function processResult(stdout: string, stderr = '') {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from(stdout)); child.stderr.emit('data', Buffer.from(stderr)); child.emit('close', 0); });
    return child as unknown as ReturnType<typeof spawn>;
  });
}
it('retains whole-file static-content rejection with bounded threads and frees the worker for the next video', async () => {
  processResult(JSON.stringify({ streams: [{ codec_type: 'video', width: 1280, height: 720 }] }));
  processResult(JSON.stringify({ format: { duration: '60' }, streams: [{ width: 1280, height: 720 }] }));
  processResult('', 'freeze_start: 0');
  await expect(assertIsRealMusicVideo('/tmp/static.mp4')).rejects.toThrow('static for 100%');
  const args = vi.mocked(spawn).mock.calls[2][1]!;
  expect(args.slice(0, 4)).toEqual(['-threads', '2', '-filter_threads', '1']);
  expect(args).not.toContain('-t'); // No shortened/sample-only validation of a completed file.
  processResult(JSON.stringify({ streams: [{ codec_type: 'video', width: 1280, height: 720 }] }));
  processResult(JSON.stringify({ format: { duration: '60' } }));
  processResult('', 'freeze_duration: 2');
  await expect(assertIsRealMusicVideo('/tmp/moving.mp4')).resolves.toBeUndefined();
});

it('runs exactly the enabled file/motion checks with the configured thresholds', async () => {
  vi.mocked(spawn).mockClear();
  const options = { checkVideoFile: false, checkVideoMotion: false, minimumDimension: 128, maximumStaticFraction: .5 };
  await assertIsRealMusicVideo('/tmp/trusted.mp4', options);
  expect(spawn).not.toHaveBeenCalled();
  processResult(JSON.stringify({ streams: [{ codec_type: 'video', width: 100, height: 100 }] }));
  await expect(assertIsRealMusicVideo('/tmp/small.mp4', { ...options, checkVideoFile: true })).rejects.toThrow('100x100');
  processResult(JSON.stringify({ format: { duration: '60' } }));
  processResult('', 'freeze_duration: 40');
  await expect(assertIsRealMusicVideo('/tmp/static.mp4', { ...options, checkVideoMotion: true })).rejects.toThrow('static for 67%');
});

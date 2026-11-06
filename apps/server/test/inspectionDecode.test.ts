import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { computeFrozenFraction } from '../src/media/inspection.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => vi.clearAllMocks());
it.each([1, null])('does not infer moving video when the decoder exits with %s', async code => {
  vi.mocked(spawn).mockImplementation((command: any) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    queueMicrotask(() => {
      if (String(command).includes('ffprobe')) {
        child.stdout.write(JSON.stringify({ format: { duration: '100' }, streams: [{ width: 640, height: 480 }] }));
        child.emit('close', 0);
      } else { child.stderr.write('Decoder failed'); child.emit('close', code); }
    });
    return child as any;
  });
  await expect(computeFrozenFraction('fixture.mp4')).rejects.toThrow('decode failed');
});

import { afterEach, expect, it, vi } from 'vitest';
import { downloadTelemetry } from '../src/providers/youtube/ytdlp.js';
import { pipelineCapacity, fragmentConcurrency, validationThreads } from '../src/pipeline/downloadTuning.js';
import { readDownloadTimings } from '../src/pipeline/downloadTimings.js';

afterEach(() => vi.unstubAllEnvs());

it('records actual extraction, transfer and merge boundaries and the last reported transfer rate', () => {
  let now = 0;
  const event = vi.fn();
  const telemetry = downloadTelemetry(event, () => now);
  now = 10; telemetry.line('__VIDARR_TRANSFER__');
  now = 1010; telemetry.line('[download] 50% VIDARR_SPEED=8388608');
  now = 2010; telemetry.line('__VIDARR_MERGE__');
  now = 2510;
  expect(telemetry.finish()).toEqual({ extractionMs: 10, transferMs: 2000, mergeMs: 500, acquisitionMs: 2510, recentBytesPerSecond: 8388608 });
  expect(event.mock.calls.filter(([value]) => value.phase).map(([value]) => value.phase)).toEqual(['extracting', 'transferring', 'merging']);
});

it('keeps unsupported timing stages unknown and discards invalid stored diagnostics', () => {
  expect(downloadTelemetry(undefined, () => 10).finish()).toEqual({ acquisitionMs: 0 });
  expect(readDownloadTimings('null')).toEqual({});
  expect(readDownloadTimings('{"transferMs":42,"invalid":"text"}')).toEqual({ transferMs: 42 });
});

it('bounds pipeline/fragment overrides and uses two decode threads only for HD by default', () => {
  expect(pipelineCapacity(3)).toBe(6);
  expect(fragmentConcurrency()).toBe(4);
  expect(validationThreads(640, 480)).toBe(1);
  expect(validationThreads(1920, 1080)).toBe(2);
  vi.stubEnv('DOWNLOAD_PIPELINE_CAPACITY', '2');
  vi.stubEnv('YTDLP_CONCURRENT_FRAGMENTS', '999');
  vi.stubEnv('VALIDATION_DECODE_THREADS', '3');
  expect(pipelineCapacity(3)).toBe(3);
  expect(fragmentConcurrency()).toBe(4);
  expect(validationThreads(640, 480)).toBe(3);
});

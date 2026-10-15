import { expect, it } from 'vitest';
import { downloadStage, formatDownloadTimings } from '../src/components/downloadStage';

it('describes stages and formats measured timings with an explicit last transfer rate', () => {
  expect(downloadStage({ status: 'importing', phase: 'validating' })).toBe('Validating');
  expect(downloadStage({ status: 'importing', phase: null })).toBe('Importing');
  expect(formatDownloadTimings({ extractionMs: 1200, transferMs: 5000, recentBytesPerSecond: 2097152 })).toBe('Formats: 1.2s · Transfer: 5.0s · Last transfer rate: 2.00 MiB/s');
  expect(formatDownloadTimings(null)).toBe('');
});

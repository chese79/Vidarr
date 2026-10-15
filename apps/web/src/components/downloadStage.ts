import type { QueueItem } from '../api/client';

export function downloadStage(item: Pick<QueueItem, 'status' | 'phase'>): string {
  const phases: Record<string, string> = { extracting: 'Finding formats', transferring: 'Downloading', merging: 'Merging audio/video',
    waitingValidation: 'Waiting for validation', validating: 'Validating', importing: 'Importing' };
  return phases[item.phase ?? ''] ?? (item.status === 'importing' ? 'Importing' : item.status === 'downloading' ? 'Downloading' : item.status);
}

export function formatDownloadTimings(timings?: Record<string, number> | null): string {
  if (!timings) return '';
  const labels: Record<string, string> = { extractionMs: 'Formats', transferMs: 'Transfer', mergeMs: 'Merge', processingWaitMs: 'Processing wait',
    validationMs: 'Validation', importMs: 'Import', totalMs: 'Total' };
  const parts = Object.entries(labels).flatMap(([key, label]) => typeof timings[key] === 'number' ? [`${label}: ${(timings[key] / 1000).toFixed(1)}s`] : []);
  if (timings.recentBytesPerSecond > 0) parts.push(`Last transfer rate: ${(timings.recentBytesPerSecond / 1048576).toFixed(2)} MiB/s`);
  return parts.join(' · ');
}

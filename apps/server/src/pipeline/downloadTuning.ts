import os from 'node:os';
import path from 'node:path';

export const STAGING_DIR = process.env.STAGING_DIR ?? path.join(os.tmpdir(), 'vidarr-staging');

export function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= maximum ? number : fallback;
}

// Reserve pipeline capacity for transfers before starting them, so simultaneous
// completions cannot overflow the bounded downloaded-file buffer.
export function pipelineCapacity(transfers: number): number {
  return Math.max(transfers, boundedInteger(process.env.DOWNLOAD_PIPELINE_CAPACITY, transfers + 3, 200));
}

export const fragmentConcurrency = () => boundedInteger(process.env.YTDLP_CONCURRENT_FRAGMENTS, 4, 8);
export const validationThreads = (width = 0, height = 0) => boundedInteger(process.env.VALIDATION_DECODE_THREADS, width >= 1280 || height >= 720 ? 2 : 1, 4);

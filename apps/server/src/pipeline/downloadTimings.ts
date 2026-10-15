export interface DownloadTimings {
  extractionMs?: number;
  transferMs?: number;
  mergeMs?: number;
  acquisitionMs?: number;
  recentBytesPerSecond?: number;
  processingWaitMs?: number;
  validationMs?: number;
  importMs?: number;
  totalMs?: number;
}

export interface DownloadTelemetry {
  phase?: 'extracting' | 'transferring' | 'merging';
  timings?: DownloadTimings;
}

export function readDownloadTimings(value: string | null | undefined): DownloadTimings {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0));
  } catch { return {}; }
}

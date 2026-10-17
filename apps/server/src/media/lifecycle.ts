export const ACTIVE_DOWNLOAD_STATUSES = ['queued', 'downloading', 'submissionUnknown', 'importing'] as const;
export type ActiveDownloadStatus = typeof ACTIVE_DOWNLOAD_STATUSES[number];
const activeStatuses: ReadonlySet<string> = new Set(ACTIVE_DOWNLOAD_STATUSES);

export function isActiveDownloadStatus(status: string): status is ActiveDownloadStatus {
  return activeStatuses.has(status);
}

export interface MediaLifecycleInput {
  localAvailable: boolean;
  serverCopies: readonly { available: boolean; confirmed: boolean }[];
  queueItems: readonly { status: string; progress?: number }[];
  awaitingDelivery: boolean;
}

export interface MediaLifecycle {
  ownership: 'both' | 'local' | 'server' | 'none';
  acquisition: ActiveDownloadStatus | 'awaitingServerScan' | 'failed' | null;
  progress: number | null;
}

// Catalog identity, monitoring and source trust belong to catalog policies.
export function deriveMediaLifecycle(input: MediaLifecycleInput): MediaLifecycle {
  const serverAvailable = input.serverCopies.some(copy => copy.available && copy.confirmed);
  const ownership = input.localAvailable
    ? serverAvailable ? 'both' : 'local'
    : serverAvailable ? 'server' : 'none';
  const active = input.queueItems.find(item => isActiveDownloadStatus(item.status));
  const acquisition = active && isActiveDownloadStatus(active.status)
    ? active.status
    : input.awaitingDelivery ? 'awaitingServerScan'
    : ownership === 'none' && input.queueItems[0]?.status === 'failed' ? 'failed' : null;
  return { ownership, acquisition, progress: active?.progress ?? null };
}

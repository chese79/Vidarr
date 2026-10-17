import type { ValidationCategory, VideoStatus } from '@vidarr/shared-types';
import { deriveMediaLifecycle, isActiveDownloadStatus } from '../media/lifecycle.js';

export interface MusicVideoStatusInput {
  hasFile: boolean;
  monitored: boolean;
  ignored: boolean;
  artistMonitored: boolean;
  libraryVideos: { available: boolean; matchConfidence: string | null }[];
  queueItems: { status: string; progress?: number }[];
  awaitingServerScanAt?: Date | null;
}

export function computeMusicVideoStatus(input: MusicVideoStatusInput): VideoStatus {
  const lifecycle = deriveMediaLifecycle({
    localAvailable: input.hasFile,
    // Probable matches remain suggestions until explicitly confirmed.
    serverCopies: input.libraryVideos.map(copy => ({ available: copy.available, confirmed: copy.matchConfidence === null })),
    queueItems: input.queueItems,
    awaitingDelivery: !!input.awaitingServerScanAt,
  });
  const eligibleForAutoSearch = input.monitored && input.artistMonitored && !input.ignored
    && lifecycle.ownership === 'none' && !input.queueItems.some(item => isActiveDownloadStatus(item.status))
    && !input.awaitingServerScanAt;
  return { ...lifecycle, eligibleForAutoSearch };
}

export function validationCategoryForSource(source: { accepted?: boolean; authority?: string; confidence?: string } | null | undefined): ValidationCategory {
  return source?.accepted && source.confidence === 'confirmed' && ['authoritative', 'verified'].includes(source.authority ?? '') ? 'canonical' : 'additional';
}

const AUTHORITY_RANK: Record<string, number> = { authoritative: 0, verified: 1, manual: 2, heuristic: 3 };

export function preferredDirectSource<T extends { id: number; authority: string; url: string }>(sources: T[]): T | undefined {
  return sources.filter(source => /^https?:\/\//i.test(source.url))
    .sort((a, b) => (AUTHORITY_RANK[a.authority] ?? 4) - (AUTHORITY_RANK[b.authority] ?? 4) || a.id - b.id)[0];
}

export const musicVideoQualifiedPlayThreshold = (durationSeconds: number): number => Math.min(durationSeconds / 2, 240);

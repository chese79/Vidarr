import { prisma } from '../db/client.js';
import type { VideoStatus } from '@vidarr/shared-types';

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'submissionUnknown', 'importing']);

export interface VideoStatusInput {
  hasFile: boolean;
  monitored: boolean;
  ignored: boolean;
  artistMonitored: boolean;
  libraryVideos: { available: boolean; matchConfidence: string | null }[];
  queueItems: { status: string; progress?: number }[];
  awaitingServerScanAt?: Date | null;
}

// The single place ownership/acquisition/eligibility get derived from raw
// rows — used by both the Artist Detail API response (so the UI never
// re-implements this) and the search-eligibility gate below (so what the UI
// shows as "missing" can never drift from what auto-search will actually
// attempt). See the Phase 2a plan for why this is orthogonal facts rather
// than one 12-value enum.
//
// A probable/ambiguous fuzzy reconciliation match (Phase 2b) is a proposed
// suggestion, not a confirmed one — only a matchConfidence of null (an exact
// key match, or a fuzzy match a human has since confirmed via the review UI)
// counts as real ownership. Otherwise an incorrect fuzzy suggestion would
// mark a genuinely missing video as present and silently suppress it from
// auto-search until someone happens to notice and review it.
export function computeVideoStatus(input: VideoStatusInput): VideoStatus {
  const availableOnServer = input.libraryVideos.some((lv) => lv.available && lv.matchConfidence === null);
  const ownership = input.hasFile && availableOnServer
    ? 'both'
    : input.hasFile
      ? 'local'
      : availableOnServer
        ? 'server'
        : 'none';

  const active = input.queueItems.find((q) => ACTIVE_STATUSES.has(q.status));
  const acquisition = active
    ? active.status as 'queued' | 'downloading' | 'submissionUnknown' | 'importing'
    : input.awaitingServerScanAt
      ? 'awaitingServerScan'
      : input.queueItems.some((q) => q.status === 'failed')
        ? 'failed'
        : null;

  const eligibleForAutoSearch =
    input.monitored &&
    input.artistMonitored &&
    !input.ignored &&
    ownership === 'none' &&
    !active &&
    !input.awaitingServerScanAt;

  return { ownership, acquisition, eligibleForAutoSearch, progress: active?.progress ?? null };
}

// Guards every grab path (automatic and manual) against creating a second
// live queue entry for a video that's already being fetched — confirmed
// during Phase 2a research that no such check existed anywhere.
export async function hasActiveDownload(musicVideoId: number): Promise<boolean> {
  const existing = await prisma.downloadQueueItem.findFirst({
    where: { musicVideoId, status: { in: ['queued', 'downloading', 'submissionUnknown', 'importing'] } },
    select: { id: true },
  });
  return existing != null;
}

import { z } from 'zod';
import { prisma } from '../db/client.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import { liveCandidate, discoveryEvidence } from './discoveryEvidence.js';
import { openLiveStartingItem } from './startingInventory.js';
import { reviewRecording } from './recordingReview.js';
import { enqueueRecording } from './acquisition.js';
import { directVideoIdentity, liveConfiguration, LiveError } from './policy.js';
import { requireLiveEnabled } from './capability.js';

export const ConfirmLiveDiscoveryInput = z.object({ identityConfirmed: z.literal(true), videoVerified: z.literal(true), sourceConfirmed: z.literal(true),
  conflictsAcknowledged: z.boolean().default(false), claimedCoverage: z.enum(['entirePerformance', 'severalSongs', 'individualSong', 'excerpt', 'unknown']).default('unknown'),
  notes: z.string().trim().max(5000).default('') }).strict();
const active = new Map<string, Promise<{ status: 'queued' | 'alreadyAvailable'; recordingId: number; queueId?: number }>>();
export const isLiveDiscoveryConfirming = (artistId: number, itemId: number) => active.has(`${artistId}:${itemId}`);
export function confirmAndGrabLiveDiscovery(artistId: number, itemId: number, input: unknown) {
  // Validate each caller before sharing an in-flight action.
  const body = ConfirmLiveDiscoveryInput.parse(input);
  const key = `${artistId}:${itemId}`;
  if (active.has(key)) return active.get(key)!;
  const task = confirm(artistId, itemId, body).finally(() => active.delete(key)); active.set(key, task); return task;
}
async function confirm(artistId: number, itemId: number, body: z.infer<typeof ConfirmLiveDiscoveryInput>) {
  await requireLiveEnabled();
  const item = await liveCandidate(artistId, itemId);
  const sourceIdentity = directVideoIdentity(item.url);
  if (item.provider !== 'youtube' || sourceIdentity.provider !== item.provider || sourceIdentity.externalId !== item.externalId) throw new LiveError('The exact upload identity changed; inspect its source before confirming');
  const evidence = (await discoveryEvidence([item], item.artist)).get(item.id)!;
  if (Object.values(evidence.checks).some(check => ['conflict', 'ambiguous'].includes(check.status)) && !body.conflictsAcknowledged) throw new LiveError('Review and acknowledge conflicting or ambiguous event evidence before confirming independently');
  if (item.recordingId) {
    const owned = await prisma.recordingPart.count({ where: { recordingId: item.recordingId, OR: [{ available: true }, { serverCopies: { some: { available: true } } }] } });
    if (owned) return { status: 'alreadyAvailable' as const, recordingId: item.recordingId };
    const queued = await prisma.downloadQueueItem.findFirst({ where: { recordingId: item.recordingId, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } });
    if (queued) return { status: 'queued' as const, recordingId: item.recordingId, queueId: queued.id };
  }
  const { policy } = await liveConfiguration();
  const rootFolderId = body.claimedCoverage === 'individualSong' ? policy.songRootFolderId : policy.fullRootFolderId;
  if (!rootFolderId) throw new LiveError('Choose the Live song/full-recording destination in Live settings before confirming and grabbing');
  await prisma.rootFolder.findUniqueOrThrow({ where: { id: rootFolderId } });
  const opened = await openLiveStartingItem(artistId, itemId);
  if (!opened.recordingId) throw new LiveError('Choose a video candidate, not a metadata reference');
  const recording = await prisma.recording.findUniqueOrThrow({ where: { id: opened.recordingId }, include: { performances: true, sources: true } });
  if (recording.performances.length !== 1) throw new LiveError('Review all linked performances on the recording page before grabbing this compilation');
  if (recording.reviewStatus === 'rejected' || recording.deletionState) throw new LiveError('Restore this recording before acquiring it');
  // Unknown dates/places stay unknown. Matching is evidence, not automatic event association.
  await reviewRecording(recording.id, { action: 'independent', performanceId: recording.performances[0].performanceId,
    videoVerified: true, notes: body.notes || 'Performer, occasion evidence, actual moving video and exact upload confirmed from Live discovery.' });
  await prisma.recording.update({ where: { id: recording.id }, data: { claimedCoverage: body.claimedCoverage,
    ...(body.claimedCoverage !== recording.claimedCoverage ? { uninterruptedVerified: false } : {}) } });
  const source = recording.sources.find(source => source.provider === sourceIdentity.provider && source.externalId === sourceIdentity.externalId);
  if (!source) throw new LiveError('The exact recording source changed; reload before grabbing');
  if (directVideoIdentity(source.url).url !== sourceIdentity.url) throw new LiveError('The recording source URL conflicts with its provider identity');
  await liveCandidate(artistId, itemId);
  await prisma.recordingSource.update({ where: { id: source.id }, data: { accepted: true } });
  // The ordinary acquisition path enforces source exclusions, deduplication, destination,
  // full validation/import and playback-server delivery. A late failure retains review for retry.
  const queued = await enqueueRecording(recording.id, source.id);
  return { status: 'queued' as const, recordingId: recording.id, queueId: queued.id };
}

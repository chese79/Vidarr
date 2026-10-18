import { prisma } from '../db/client.js';
import { liveConfiguration, LiveError } from './policy.js';
import { verifiedImprovement } from './evidence.js';
import { scheduleRecordingDeletion } from './deletion.js';

// Cleanup is proposed only after an independently validated replacement is delivered.
// Recheck at confirmation time, and use the same delayed deletion path as manual deletion.
export async function redundantRecordings(replacementId: number) {
  const { policy } = await liveConfiguration();
  if (!policy.cleanupRedundantRecordings) return [];
  const replacement = await prisma.recording.findUniqueOrThrow({ where: { id: replacementId }, include: {
    performances: true, parts: { include: { coverage: true, serverCopies: true } },
  } });
  const connectorId = replacement.claimedCoverage === 'individualSong' ? policy.songConnectorId : policy.fullConnectorId;
  const libraryId = replacement.claimedCoverage === 'individualSong' ? policy.songLibraryId : policy.fullLibraryId;
  if (replacement.catalogType !== 'live' || replacement.deletionState || !replacement.identityVerified || !replacement.videoVerified
    || replacement.reviewStatus !== 'accepted' || !replacement.parts.length || !connectorId || !libraryId
    || replacement.parts.some(part => !part.serverCopies.some(copy => copy.available && copy.connectorId === connectorId && copy.libraryId === libraryId))) return [];
  const eventIds = replacement.performances.map(link => link.performanceId);
  const candidates = await prisma.recording.findMany({ where: { id: { not: replacementId }, catalogType: 'live', pinned: false, deletionState: null,
    performances: { some: { performanceId: { in: eventIds } } },
    queueItems: { none: { status: { in: ['queued', 'downloading', 'importing', 'submissionUnknown'] } } },
  }, include: { performances: true, parts: { include: { coverage: true, playlistItems: true } } }, take: 100 });
  const replacementSongs = new Set(replacement.parts.flatMap(part => part.coverage.filter(item => item.verified && item.fullSong).map(item => item.songId)));
  const eligible = [];
  for (const current of candidates) {
    if (!current.parts.length || !verifiedImprovement(replacement, current, policy.qualityOrder)
      || current.performances.some(link => !eventIds.includes(link.performanceId)) || current.parts.some(part => part.playlistItems.length)) continue;
    // Unknown or partial coverage cannot prove that an older recording is redundant.
    const coverage = current.parts.flatMap(part => part.coverage);
    if (!coverage.length || coverage.some(item => !item.verified || !item.fullSong || !replacementSongs.has(item.songId))) continue;
    if (current.uninterruptedVerified && !replacement.uninterruptedVerified) continue;
    if (await prisma.liveViewing.count({ where: { active: true, partId: { in: current.parts.map(part => part.id) } } })) continue;
    eligible.push({ id: current.id, title: current.title });
  }
  return eligible;
}
export async function confirmRedundantCleanup(replacementId: number, recordingId: number, confirmed: boolean) {
  if (!(await redundantRecordings(replacementId)).some(item => item.id === recordingId)) throw new LiveError('This recording is no longer safely redundant; reload and review its coverage and ownership');
  await scheduleRecordingDeletion(recordingId, confirmed);
  await prisma.history.create({ data: { recordingId, eventType: 'redundantRecordingCleanupScheduled', data: JSON.stringify({ replacementId }) } });
  return { scheduled: true };
}

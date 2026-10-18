import { prisma } from '../db/client.js';
import { coverageSummary } from './evidence.js';

export async function performanceStates(ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  const rows = await prisma.livePerformance.findMany({ where: { id: { in: ids } }, include: { songs: true,
    recordings: { where: { recording: { reviewStatus: 'accepted', identityVerified: true, videoVerified: true, deletionState: null } }, include: {
      recording: { include: { parts: { include: { coverage: true, serverCopies: { where: { available: true, connector: { enabled: true } } } } } } } } } } });
  return new Map(rows.map(row => {
    const known = row.recordings.length > 0;
    const parts = row.recordings.flatMap(link => link.recording.parts.filter(part => part.available || part.serverCopies.length));
    const summary = coverageSummary(row.songs, parts.flatMap(part => part.coverage), row.referenceComplete);
    const state = !known ? 'recordingUnknown' : !parts.length ? row.monitored && !row.ignored ? 'missing' : 'availableExternally'
      : summary.expected && summary.covered && summary.covered < summary.expected ? 'partial' : summary.complete ? 'songsComplete'
        : summary.allKnownCovered ? 'allKnownSongsCovered' : 'ownedCoverageUnknown';
    return [row.id, state];
  }));
}

import type { LivePerformance, Recording } from '@prisma/client';

export interface IdentityEvidence { artistMbid?: string; performanceDate?: string; venueId?: string; venue?: string; song?: string; conflicts?: string[]; uploadDate?: string; broadcastDate?: string }
const key = (value?: string | null) => (value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function exactLiveMatch(evidence: IdentityEvidence, event: Pick<LivePerformance, 'performanceDate' | 'venueExternalId' | 'venue'> & { artistMbid: string; songs: { title: string }[] }): boolean {
  return Boolean(evidence.artistMbid && evidence.artistMbid === event.artistMbid
    && /^\d{4}-\d{2}-\d{2}$/.test(evidence.performanceDate ?? '') && evidence.performanceDate === event.performanceDate
    && (evidence.venueId ? evidence.venueId === event.venueExternalId : key(evidence.venue) && key(evidence.venue) === key(event.venue))
    && evidence.song && event.songs.some(song => key(song.title) === key(evidence.song)) && !evidence.conflicts?.length);
}
export function verifiedImprovement(candidate: Pick<Recording, 'qualityVerified' | 'verifiedCoverage' | 'audioScore' | 'visualScore' | 'resolution'>,
  current: Pick<Recording, 'pinned' | 'qualityVerified' | 'verifiedCoverage' | 'audioScore' | 'visualScore' | 'resolution'>,
  order: ('coverage' | 'audio' | 'visual' | 'resolution')[]): boolean {
  if (current.pinned || !candidate.qualityVerified || !current.qualityVerified) return false;
  const fields = { coverage: 'verifiedCoverage', audio: 'audioScore', visual: 'visualScore', resolution: 'resolution' } as const;
  // Unknown evidence never establishes a comparison or a safe automatic upgrade.
  for (const item of order) {
    const a = candidate[fields[item]], b = current[fields[item]];
    if (a === null || b === null) return false;
    if (a !== b) return a > b;
  }
  return false;
}
export function coverageSummary(songs: { id: number; kind: string }[], coverage: { songId: number; verified: boolean; fullSong: boolean }[], completeReference: boolean) {
  const expected = songs.filter(song => !['snippet', 'medleyComponent'].includes(song.kind));
  const covered = new Set(coverage.filter(item => item.verified && item.fullSong).map(item => item.songId));
  const count = expected.filter(song => covered.has(song.id)).length;
  return { expected: expected.length, covered: count, complete: expected.length > 0 && count === expected.length && completeReference,
    allKnownCovered: expected.length > 0 && count === expected.length, referenceComplete: completeReference };
}

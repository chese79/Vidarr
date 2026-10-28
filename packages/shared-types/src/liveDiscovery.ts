export type LiveMatchProvider = 'musicbrainz' | 'setlist.fm';
export type LiveMatchStatus = 'notChecked' | 'pending' | 'strong' | 'possible' | 'songOnly' | 'noMatch' | 'conflict' | 'ambiguous' | 'error' | 'unavailable';
export type LiveEvidenceField = 'artist' | 'song' | 'date' | 'venue' | 'city' | 'event';
export interface LiveEvidenceFact { field: LiveEvidenceField; value: string; source: string; url?: string; basis: 'catalog' | 'claim' | 'reference' }
export interface LiveReferenceEvidence {
  id: string; title: string; url: string; artistMbid: string; kind: 'song' | 'event' | 'release';
  date?: string; venue?: string; city?: string; event?: string; songs?: string[];
}
export interface LiveReferenceComparison extends LiveReferenceEvidence {
  status: LiveMatchStatus; matches: LiveEvidenceField[]; conflicts: LiveEvidenceField[]; score: number;
}
export interface LiveProviderCheck {
  status: LiveMatchStatus; checkedAt: string | null; fingerprint: string; scope: string;
  references: LiveReferenceComparison[]; error?: string; page?: number; hasMore?: boolean;
}
export interface LiveDiscoveryEvidence { facts: LiveEvidenceFact[]; checks: Record<LiveMatchProvider, LiveProviderCheck> }

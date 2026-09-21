// Matches a scanned media-server video against vidarr's own catalog with a
// confidence tier, replacing a single exact-key-only lookup. See the Phase
// 2b plan for the full reasoning — in short: an exact, normalized
// artist+title match stays free (confidence null, meaning "confident," zero
// behavior change from before); anything else falls back to a small,
// dependency-free title-similarity score scoped to the same artist's known
// videos, classified probable/ambiguous, or no match at all.

export type MatchConfidence = 'probable' | 'ambiguous';

export interface CanonicalVideo {
  id: number;
  normalizedTitle: string;
  normalizedArtistName: string;
  releaseYear: number | null;
}

export interface MatchCandidate {
  normalizedArtistName: string;
  normalizedTitle: string;
  releaseYear: number | null;
}

export interface PreviousMatch {
  musicVideoId: number | null;
  matchConfidence: MatchConfidence | null;
}

export interface MatchResult {
  musicVideoId: number | null;
  matchConfidence: MatchConfidence | null;
}

const PROBABLE_THRESHOLD = 0.5;
const AMBIGUOUS_THRESHOLD = 0.3;

// Jaccard index over normalized-title word sets — deliberately simple and
// dependency-free (no string-similarity library exists anywhere in this
// codebase), handles reordered words and shared substrings ("(Official
// Video)", "(Remastered)") reasonably without true edit-distance's cost or
// surprises. Inputs are expected to already be normalizeTitle()'d.
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// Order: exact key, then the best same-artist fuzzy candidate, then whatever
// was matched before (a previously-good match must never silently vanish
// just because this sync's search comes up empty — see Phase 2a), then
// genuinely nothing. A rejectedMusicVideoId is excluded at every stage so a
// human's "not that one" decision sticks across syncs instead of being
// immediately re-proposed.
export function matchLibraryVideo(
  candidate: MatchCandidate,
  canonicalVideos: CanonicalVideo[],
  previous: PreviousMatch | null,
  rejectedMusicVideoId: number | null,
): MatchResult {
  const exact = canonicalVideos.find(
    (v) =>
      v.normalizedArtistName === candidate.normalizedArtistName &&
      v.normalizedTitle === candidate.normalizedTitle &&
      v.id !== rejectedMusicVideoId,
  );
  if (exact) {
    return { musicVideoId: exact.id, matchConfidence: null };
  }

  const sameArtist = canonicalVideos.filter(
    (v) => v.normalizedArtistName === candidate.normalizedArtistName && v.id !== rejectedMusicVideoId,
  );
  let best: { video: CanonicalVideo; score: number } | null = null;
  for (const video of sameArtist) {
    const score = tokenSimilarity(video.normalizedTitle, candidate.normalizedTitle);
    if (!best || score > best.score) best = { video, score };
  }

  if (best && best.score >= AMBIGUOUS_THRESHOLD) {
    const yearConflict =
      best.video.releaseYear != null &&
      candidate.releaseYear != null &&
      best.video.releaseYear !== candidate.releaseYear;
    const matchConfidence: MatchConfidence =
      best.score >= PROBABLE_THRESHOLD && !yearConflict ? 'probable' : 'ambiguous';
    return { musicVideoId: best.video.id, matchConfidence };
  }

  if (previous && previous.musicVideoId != null && previous.musicVideoId !== rejectedMusicVideoId) {
    return { musicVideoId: previous.musicVideoId, matchConfidence: previous.matchConfidence };
  }

  return { musicVideoId: null, matchConfidence: null };
}

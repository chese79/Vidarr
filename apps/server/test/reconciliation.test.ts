import { describe, it, expect } from 'vitest';
import { tokenSimilarity, matchLibraryVideo, type CanonicalVideo } from '../src/pipeline/reconciliation.js';

describe('tokenSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(tokenSimilarity('blinding lights', 'blinding lights')).toBe(1);
  });

  it('is 1 for two empty strings', () => {
    expect(tokenSimilarity('', '')).toBe(1);
  });

  it('is 0 when one side is empty and the other is not', () => {
    expect(tokenSimilarity('blinding lights', '')).toBe(0);
  });

  it('is high but not 1 for a near-match with an extra qualifier word', () => {
    const score = tokenSimilarity('blinding lights', 'blinding lights official video');
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });

  it('is 0 for completely unrelated titles', () => {
    expect(tokenSimilarity('blinding lights', 'thriller')).toBe(0);
  });

  it('is order-independent (word reordering does not change the score)', () => {
    expect(tokenSimilarity('a b c', 'c b a')).toBe(1);
  });
});

describe('matchLibraryVideo', () => {
  const catalog: CanonicalVideo[] = [
    { id: 1, normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights', releaseYear: 2019 },
    { id: 2, normalizedArtistName: 'the weeknd', normalizedTitle: 'save your tears', releaseYear: 2020 },
  ];

  it('returns an exact key match with null confidence (the free, unchanged fast path)', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights', releaseYear: 2019 },
      catalog,
      null,
      null,
    );
    expect(result).toEqual({ musicVideoId: 1, matchConfidence: null });
  });

  it('classifies a close near-miss title as probable when the year agrees', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights official video', releaseYear: 2019 },
      catalog,
      null,
      null,
    );
    expect(result.musicVideoId).toBe(1);
    expect(result.matchConfidence).toBe('probable');
  });

  it('downgrades an otherwise-probable match to ambiguous on a year conflict', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights official video', releaseYear: 1999 },
      catalog,
      null,
      null,
    );
    expect(result.musicVideoId).toBe(1);
    expect(result.matchConfidence).toBe('ambiguous');
  });

  it('does not downgrade for a missing year on either side (absence is not a conflict)', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights official video', releaseYear: null },
      catalog,
      null,
      null,
    );
    expect(result.matchConfidence).toBe('probable');
  });

  it('finds no match at all for a completely different artist', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'someone else', normalizedTitle: 'blinding lights', releaseYear: 2019 },
      catalog,
      null,
      null,
    );
    expect(result).toEqual({ musicVideoId: null, matchConfidence: null });
  });

  it('preserves a previous match when this sync finds nothing at all', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'completely unrelated title text', releaseYear: null },
      catalog,
      { musicVideoId: 1, matchConfidence: null },
      null,
    );
    expect(result).toEqual({ musicVideoId: 1, matchConfidence: null });
  });

  it('preserves a previous probable match verbatim, not just the id', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'completely unrelated title text', releaseYear: null },
      catalog,
      { musicVideoId: 1, matchConfidence: 'probable' },
      null,
    );
    expect(result).toEqual({ musicVideoId: 1, matchConfidence: 'probable' });
  });

  it('never re-proposes a rejected candidate via the exact-key path', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights', releaseYear: 2019 },
      catalog,
      null,
      1,
    );
    expect(result).toEqual({ musicVideoId: null, matchConfidence: null });
  });

  it('never re-proposes a rejected candidate via the fuzzy fallback either', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'blinding lights official video', releaseYear: 2019 },
      catalog,
      null,
      1,
    );
    expect(result).toEqual({ musicVideoId: null, matchConfidence: null });
  });

  it('a rejected id does not block preserving a different previous match', () => {
    const result = matchLibraryVideo(
      { normalizedArtistName: 'the weeknd', normalizedTitle: 'completely unrelated title text', releaseYear: null },
      catalog,
      { musicVideoId: 2, matchConfidence: 'probable' },
      1,
    );
    expect(result).toEqual({ musicVideoId: 2, matchConfidence: 'probable' });
  });
});

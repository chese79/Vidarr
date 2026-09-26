import { describe, expect, it } from 'vitest';
import { assessArtistCandidate, type MusicBrainzArtist } from '../src/providers/metadata/musicbrainz.js';

const candidate: MusicBrainzArtist = {
  id: '8538e728-ca0b-4321-b7e5-cff6565dd4c0',
  name: 'Depeche Mode',
  sortName: 'Depeche Mode',
  type: 'Group',
  country: 'GB',
  disambiguation: null,
  genres: ['synth-pop'],
  aliases: ['Composition of Sound'],
  score: 100,
};

describe('MusicBrainz artist candidate assessment', () => {
  it('keeps an exact name-only match below automatic confirmation confidence', () => {
    const result = assessArtistCandidate('Depeche Mode', candidate);
    expect(result.exactName).toBe(true);
    expect(result.supportingEvidence).toEqual([]);
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('recognizes aliases but still requires independent evidence', () => {
    const result = assessArtistCandidate('Composition of Sound', candidate);
    expect(result.exactName).toBe(true);
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('raises confidence when type and country support an exact match', () => {
    const result = assessArtistCandidate('Depeche Mode', candidate, { artistType: 'group', country: 'gb' });
    expect(result.supportingEvidence).toEqual(['country', 'artistType']);
    expect(result.confidence).toBeGreaterThanOrEqual(0.98);
  });

  it('does not let a high MusicBrainz search score substitute for an exact name', () => {
    const result = assessArtistCandidate('Depeche M0de', candidate);
    expect(result.exactName).toBe(false);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('uses observed recording and release credits to distinguish otherwise identical candidates', () => {
    const supported = assessArtistCandidate('Depeche Mode', candidate, {
      recordingMatchCount: 1,
      releaseMatchCount: 1,
    });
    const nameOnly = assessArtistCandidate('Depeche Mode', candidate);
    expect(supported.supportingEvidence).toEqual(['observed-recording-credit', 'observed-release-credit']);
    expect(supported.confidence).toBeGreaterThan(nameOnly.confidence);
    expect(supported.recordingMatchCount).toBe(1);
    expect(supported.releaseMatchCount).toBe(1);
    expect(supported.confidence).toBeLessThan(1);
  });

  it('does not score missing recording or release evidence against a candidate', () => {
    expect(assessArtistCandidate('Depeche Mode', candidate, { recordingMatchCount: 0, releaseMatchCount: 0 }))
      .toEqual(assessArtistCandidate('Depeche Mode', candidate));
  });
});

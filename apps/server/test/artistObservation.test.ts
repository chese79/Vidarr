import { describe, expect, it } from 'vitest';
import { artistNameHint, isUsableArtistHint } from '../src/pipeline/artistObservation.js';

describe('artist observation names', () => {
  it('treats a VEVO channel as a hint for its artist, not a separate artist', () => {
    expect(artistNameHint('311VEVO')).toBe('311');
    expect(artistNameHint('ACDC VEVO')).toBe('ACDC');
  });

  it('does not promote generic uploader labels to artist hints', () => {
    expect(isUsableArtistHint(artistNameHint('Unknown Artist'))).toBe(false);
    expect(isUsableArtistHint(artistNameHint('VEVO'))).toBe(false);
  });
});

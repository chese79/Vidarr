import { describe, it, expect } from 'vitest';
import { parseQualityFromTitle } from '../src/pipeline/qualityParser.js';

describe('parseQualityFromTitle', () => {
  it.each([
    ['Artist - Song (2020) [2160p]', '2160p'],
    ['Artist - Song (2020) [4K]', '2160p'],
    ['Artist - Song (2020) [1080p]', '1080p'],
    ['Artist - Song (2020) [720p]', '720p'],
    ['Artist - Song (2020) [480p]', 'SD'],
    ['Artist - Song (2020) [SD]', 'SD'],
  ])('parses %s as %s', (title, expected) => {
    expect(parseQualityFromTitle(title)).toBe(expected);
  });

  it('defaults to SD when no resolution token is present', () => {
    expect(parseQualityFromTitle('Artist - Song (2020)')).toBe('SD');
  });

  it('is case-insensitive', () => {
    expect(parseQualityFromTitle('artist - song [1080P]')).toBe('1080p');
  });

  it('matches the highest-priority pattern when multiple are present', () => {
    // 2160p is checked before 1080p in the pattern table.
    expect(parseQualityFromTitle('Remux [1080p to 2160p upscale]')).toBe('2160p');
  });

  it('does not match a resolution token embedded inside a larger word', () => {
    // "4Kids" has no word boundary between "k" and "i" — must not match \b4k\b.
    expect(parseQualityFromTitle('A 4Kids Cartoon Rip')).toBe('SD');
  });

  it('still matches a standalone token elsewhere in a title containing a near-miss', () => {
    // "4Kids" doesn't match, but the later standalone "4k" does.
    expect(parseQualityFromTitle('A 4Kids Cartoon Rip, actually 4k video')).toBe('2160p');
  });
});

import { describe, expect, it } from 'vitest';
import { preferredDirectSource } from '../src/pipeline/directSourcePriority.js';

describe('direct acquisition source priority', () => {
  it('prefers authoritative, then verified, manual, and heuristic links regardless of insertion order', () => {
    const sources = [
      { id: 1, authority: 'heuristic', url: 'https://example.com/heuristic' },
      { id: 2, authority: 'verified', url: 'https://example.com/verified' },
      { id: 3, authority: 'authoritative', url: 'https://example.com/authoritative' },
      { id: 4, authority: 'manual', url: 'https://example.com/manual' },
    ];
    expect(preferredDirectSource(sources)?.id).toBe(3);
    expect(preferredDirectSource(sources.filter((source) => source.id !== 3))?.id).toBe(2);
    expect(preferredDirectSource(sources.filter((source) => source.id === 1 || source.id === 4))?.id).toBe(4);
    expect(sources.map((source) => source.id)).toEqual([1, 2, 3, 4]);
  });

  it('ignores non-web links and uses id as a stable tie breaker', () => {
    expect(preferredDirectSource([
      { id: 1, authority: 'authoritative', url: 'file:///media/video.mp4' },
      { id: 3, authority: 'verified', url: 'https://example.com/three' },
      { id: 2, authority: 'verified', url: 'https://example.com/two' },
    ])?.id).toBe(2);
  });
});

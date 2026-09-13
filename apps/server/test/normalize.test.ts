import { describe, it, expect } from 'vitest';
import { normalizeTitle, sortNameFor, squash } from '../src/pipeline/normalize.js';

describe('normalizeTitle', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normalizeTitle("Rock & Roll -- Ain't It Great?!")).toBe('rock roll ain t it great');
  });

  it('strips combining diacritics after NFKD decomposition', () => {
    expect(normalizeTitle('Beyoncé')).toBe('beyonce');
    expect(normalizeTitle('Mötley Crüe')).toBe('motley crue');
  });

  it('trims leading/trailing whitespace produced by collapsing', () => {
    expect(normalizeTitle('  Hello World!!!  ')).toBe('hello world');
  });
});

describe('sortNameFor', () => {
  it('strips a leading "The"', () => {
    expect(sortNameFor('The Beatles')).toBe('Beatles');
  });

  it('strips a leading "A" or "An"', () => {
    expect(sortNameFor('A Perfect Circle')).toBe('Perfect Circle');
    expect(sortNameFor('An Artist')).toBe('Artist');
  });

  it('is case-insensitive on the article', () => {
    expect(sortNameFor('the beatles')).toBe('beatles');
  });

  it('leaves a name with no leading article unchanged', () => {
    expect(sortNameFor('Radiohead')).toBe('Radiohead');
  });

  it('does not strip an article that is not a whole leading word', () => {
    expect(sortNameFor('Theory of a Deadman')).toBe('Theory of a Deadman');
  });
});

describe('squash', () => {
  it('removes all whitespace in addition to normalizing', () => {
    expect(squash('Rick Astley')).toBe('rickastley');
  });

  it('matches a channel-handle style name against a spaced artist name', () => {
    expect(squash('Rick Astley')).toBe(squash('RickAstleyYT'.replace(/YT$/, '')));
  });
});

import { describe, it, expect } from 'vitest';
import { MUSICBRAINZ_GENRES } from '../src/data/musicbrainzGenres.js';
import { BROAD_GENRES, classifyGenre, isOfficialGenre, normalizeGenreName, parseGenreList } from '../src/pipeline/genreTaxonomy.js';

describe('genre vocabulary', () => {
  it('bundles the MusicBrainz list, lowercase and de-duplicated', () => {
    expect(MUSICBRAINZ_GENRES.length).toBeGreaterThan(2000);
    expect(new Set(MUSICBRAINZ_GENRES).size).toBe(MUSICBRAINZ_GENRES.length);
    expect(MUSICBRAINZ_GENRES.every((g) => g === g.toLowerCase())).toBe(true);
    expect(MUSICBRAINZ_GENRES).toContain('rock');
  });

  it('every broad genre is itself in the vocabulary', () => {
    for (const genre of BROAD_GENRES) expect(isOfficialGenre(genre), genre).toBe(true);
  });
});

describe('normalizeGenreName', () => {
  it('resolves spelling variants to the MusicBrainz spelling', () => {
    expect(normalizeGenreName('Hip-Hop')).toBe('hip hop');
    expect(normalizeGenreName('synthpop')).toBe('synth-pop');
    expect(normalizeGenreName('  Pop/Rock ')).toBe('pop rock');
    expect(normalizeGenreName('rnb')).toBe('r&b');
    expect(normalizeGenreName('rap')).toBe('hip hop');
    expect(normalizeGenreName('Singer/Songwriter')).toBe('singer-songwriter');
  });

  it('keeps unknown free text, tidied, rather than dropping it', () => {
    expect(normalizeGenreName('  Space   Ska ')).toBe('space ska');
    expect(isOfficialGenre('space ska')).toBe(false);
    expect(normalizeGenreName('   ')).toBe('');
  });
});

describe('classifyGenre', () => {
  it('treats the broad genres as top level', () => {
    expect(classifyGenre('Rock')).toEqual({ name: 'rock', level: 'genre', parent: null, official: true });
  });

  it('rolls sub-genres up into their broad genre', () => {
    expect(classifyGenre('alternative rock')).toMatchObject({ level: 'subgenre', parent: 'rock' });
    expect(classifyGenre('death metal')).toMatchObject({ level: 'subgenre', parent: 'metal' });
    expect(classifyGenre('synth-pop')).toMatchObject({ level: 'subgenre', parent: 'pop' });
    expect(classifyGenre('trip hop')).toMatchObject({ level: 'subgenre', parent: 'electronic' });
    expect(classifyGenre('drum and bass')).toMatchObject({ level: 'subgenre', parent: 'electronic' });
    expect(classifyGenre('post-hardcore')).toMatchObject({ level: 'subgenre', parent: 'punk' });
  });

  it('gives a sub-genre no parent rather than a wrong one when it cannot tell', () => {
    expect(classifyGenre('xyzzy sound')).toMatchObject({ level: 'subgenre', parent: null, official: false });
  });

  it('returns null for empty input', () => {
    expect(classifyGenre('  ')).toBeNull();
  });
});

describe('parseGenreList', () => {
  it('splits, normalises, de-duplicates and keeps order', () => {
    expect(parseGenreList('Rock, hip-hop; ROCK ,Synthpop')).toEqual(['rock', 'hip hop', 'synth-pop']);
    expect(parseGenreList(null)).toEqual([]);
    expect(parseGenreList('')).toEqual([]);
  });
});

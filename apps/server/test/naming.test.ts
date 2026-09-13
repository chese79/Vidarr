import { describe, it, expect } from 'vitest';
import { sanitizeForPath, renderNamingFormat } from '@vidarr/shared-types';

describe('sanitizeForPath', () => {
  it('passes through an ordinary segment unchanged', () => {
    expect(sanitizeForPath('My Video (2020)')).toBe('My Video (2020)');
  });

  it('strips path separator and reserved characters', () => {
    expect(sanitizeForPath('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeForPath('  padded  ')).toBe('padded');
  });

  // Regression coverage for the path-traversal class this function exists to
  // block (CWE-22, same class as Sonarr's CVE-2026-30976): a segment that
  // collapses to exactly "." or ".." after stripping is a real traversal
  // component once path.join'd, even though it "looks" harmless post-strip.
  it('neutralizes a bare ".." segment instead of leaving it traversable', () => {
    expect(sanitizeForPath('..')).toBe('_');
  });

  it('neutralizes a bare "." segment', () => {
    expect(sanitizeForPath('.')).toBe('_');
  });

  it('neutralizes ".." even when disguised with separator characters around it', () => {
    // "/../" and "\..\" both strip down to exactly ".."
    expect(sanitizeForPath('/../')).toBe('_');
    expect(sanitizeForPath('\\..\\')).toBe('_');
  });

  it('neutralizes a segment that is empty after stripping', () => {
    expect(sanitizeForPath('///')).toBe('_');
  });

  it('does not neutralize a segment that merely contains ".." as a substring', () => {
    // "foo..bar" is not equal to "..", so it's a real (if odd) filename, not a
    // traversal attempt.
    expect(sanitizeForPath('foo..bar')).toBe('foo..bar');
  });
});

describe('renderNamingFormat', () => {
  const baseTokens = { artistName: 'Rick Astley', videoTitle: 'Never Gonna Give You Up', year: 1987, quality: '1080p' };

  it('substitutes every token', () => {
    const result = renderNamingFormat('{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]', baseTokens);
    expect(result).toBe('Rick Astley/Rick Astley - Never Gonna Give You Up (1987) [1080p]');
  });

  it('renders "Unknown" for a null year', () => {
    const result = renderNamingFormat('{Video Title} ({Year})', { ...baseTokens, year: null });
    expect(result).toBe('Never Gonna Give You Up (Unknown)');
  });

  it("an artist name that is exactly '..' does not escape the root folder", () => {
    // Regression test for the exact scenario the security review flagged:
    // a bare {Artist Name} segment whose value is literally "..".
    const result = renderNamingFormat('{Artist Name}/{Video Title}', { ...baseTokens, artistName: '..' });
    expect(result.split('/')[0]).not.toBe('..');
    expect(result).toBe('_/Never Gonna Give You Up');
  });

  it('an artist name containing embedded slashes cannot introduce a new path segment', () => {
    // Substitution happens after format.split('/'), so a "/" inside a
    // token's value must not re-introduce a directory boundary once stripped.
    const result = renderNamingFormat('{Artist Name}', { ...baseTokens, artistName: 'foo/../../etc/passwd' });
    expect(result).not.toContain('/');
    expect(result.split('/').length).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { isPathWithinRoot } from '../src/pipeline/pathContainment.js';

// Defense-in-depth check for CWE-22 (same class as Sonarr's CVE-2026-30976) —
// pipeline/import.ts's second, independent layer against path traversal in
// computed destination paths, on top of naming.ts's sanitizeForPath.
describe('isPathWithinRoot', () => {
  const root = path.resolve('/media/library');

  it('allows a destination nested inside the root', () => {
    expect(isPathWithinRoot(root, path.join(root, 'Artist', 'song.mp4'))).toBe(true);
  });

  it('allows the root itself', () => {
    expect(isPathWithinRoot(root, root)).toBe(true);
  });

  it('rejects a destination that resolves outside the root via ".."', () => {
    expect(isPathWithinRoot(root, path.join(root, '..', 'escaped', 'song.mp4'))).toBe(false);
  });

  it('rejects an absolute destination entirely outside the root', () => {
    expect(isPathWithinRoot(root, path.resolve('/etc/passwd'))).toBe(false);
  });

  it('does not treat a sibling directory with the root as a string-prefix as contained', () => {
    // e.g. root "/media/library" vs dest "/media/library-other/x" — a naive
    // startsWith(root) check (without the path.sep suffix) would wrongly
    // allow this; the real check requires startsWith(root + path.sep).
    const sibling = path.resolve('/media/library-other/x.mp4');
    expect(isPathWithinRoot(root, sibling)).toBe(false);
  });

  it('rejects a deeply nested traversal that still escapes after resolution', () => {
    expect(isPathWithinRoot(root, path.join(root, 'a', 'b', '..', '..', '..', 'c'))).toBe(false);
  });
});

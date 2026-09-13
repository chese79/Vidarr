import path from 'node:path';

// Defense in depth against path traversal (CWE-22) — sanitizeForPath already
// neutralizes bare "."/".." segments upstream (packages/shared-types/src/naming.ts),
// but file placement is a security boundary and shouldn't rely on a single
// upstream check being perfect. Same vulnerability class as Sonarr's
// CVE-2026-30976. Extracted as its own function so it's directly testable
// without needing a full import pipeline (DB + real files) around it.
export function isPathWithinRoot(rootPath: string, destPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDest = path.resolve(destPath);
  return resolvedDest === resolvedRoot || resolvedDest.startsWith(resolvedRoot + path.sep);
}

// Shared by the server (actual file placement) and the web UI (live settings
// preview) so the preview can never drift from what an import will actually do.
//
// Security: stripping the path-separator characters alone isn't enough — a
// segment that collapses to exactly "." or ".." (e.g. an Artist named
// literally ".." with the naming pattern's first segment being bare
// {Artist Name}) still resolves as a real traversal component once
// path.join'd against the root folder (see pipeline/import.ts's containment
// check, which is the second, independent layer against the same class of
// bug — matches Sonarr's own CVE-2026-30976 path-traversal advisory: don't
// rely on a single point of sanitization for file placement).
export function sanitizeForPath(segment: string): string {
  const stripped = segment.replace(/[<>:"/\\|?*]/g, '').trim();
  return stripped === '.' || stripped === '..' || stripped === '' ? '_' : stripped;
}

export interface NamingTokens {
  artistName: string;
  videoTitle: string;
  year: number | null;
  quality: string;
}

export function renderNamingFormat(format: string, tokens: NamingTokens): string {
  return format
    .split('/')
    .map((segment) =>
      sanitizeForPath(
        segment
          .replace(/\{Artist Name\}/g, tokens.artistName)
          .replace(/\{Video Title\}/g, tokens.videoTitle)
          .replace(/\{Year\}/g, tokens.year ? String(tokens.year) : 'Unknown')
          .replace(/\{Quality\}/g, tokens.quality),
      ),
    )
    .join('/');
}

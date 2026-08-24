// Shared by the server (actual file placement) and the web UI (live settings
// preview) so the preview can never drift from what an import will actually do.
export function sanitizeForPath(segment: string): string {
  return segment.replace(/[<>:"/\\|?*]/g, '').trim();
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

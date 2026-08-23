export function sanitizeForPath(segment: string): string {
  return segment.replace(/[<>:"/\\|?*]/g, '').trim();
}

export function renderNamingFormat(
  format: string,
  tokens: { artistName: string; videoTitle: string; year: number | null; quality: string },
): string {
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

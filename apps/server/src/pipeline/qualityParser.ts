// Parses a release title into a quality name matching one of the seeded
// Quality rows (SD/720p/1080p/2160p) — the same kind of regex-table approach
// Sonarr/Radarr use for scene-release titles, scoped down to resolution only
// since that's what distinguishes vidarr's seeded quality tiers.
const RESOLUTION_PATTERNS: [RegExp, string][] = [
  [/\b2160p\b|\b4k\b/i, '2160p'],
  [/\b1080p\b/i, '1080p'],
  [/\b720p\b/i, '720p'],
  [/\b480p\b|\bSD\b/i, 'SD'],
];

export function parseQualityFromTitle(title: string): string {
  for (const [pattern, quality] of RESOLUTION_PATTERNS) {
    if (pattern.test(title)) return quality;
  }
  return 'SD';
}

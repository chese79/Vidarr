import { normalizeTitle } from '../pipeline/normalize.js';

export function reviewIndexerIdentity(title: string, artist: string, song: string): { accepted: boolean; reason: string } {
  const normalized = normalizeTitle(title);
  if (/\b(live|concert|full album|discography|audio only|lyrics?|karaoke|cover|tribute|pack|collection)\b/.test(normalized)) {
    return { accepted: false, reason: 'Content type or version requires manual review' };
  }
  // Strip presentation/encoding labels only. Unknown suffixes (including a
  // different song/version) remain and cannot silently become an exact match.
  const identity = normalized.replace(/\b(?:official music video|official video|music video|1080p|720p|2160p|480p|4k|uhd|hd|web dl|webrip|web|h264|h265|x264|x265|hevc|avc|aac|flac|mp4|mkv)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const expected = `${normalizeTitle(artist)} ${normalizeTitle(song)}`;
  return identity === expected
    ? { accepted: true, reason: 'Exact artist and song identity' }
    : { accepted: false, reason: 'Artist/song identity is not an exact match; review the source' };
}

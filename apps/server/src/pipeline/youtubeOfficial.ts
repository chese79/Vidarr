import { getVideoMetadata } from '../providers/youtube/ytdlp.js';
import { hasOfficialKeyword, type DiscoveredYoutubeVideo } from '../providers/youtube/musicDiscovery.js';
import { classifyCandidate, resolveReview, type ClassificationResult } from './youtubeValidation.js';
import { normalizeTitle, squash } from './normalize.js';
import { parseArtistAndTitle } from './bulkImport.js';

export function officialSongIdentity(rawTitle: string, channel: string, artist: string): string | null {
  const split = /^(.{1,100}?)\s+[-–—]\s+(.+)$/.exec(rawTitle);
  const artistKey = normalizeTitle(artist);
  if (!artistKey) return null;
  // A conflicting explicit credit cannot be rescued by playlist membership or uploader name.
  if (split && normalizeTitle(split[1]) !== artistKey) return null;
  const channelKey = squash(channel).replace(/^(official|oficial)/, '').replace(/(?:vevo|official|oficial|music|band)$/, '');
  if (!split && channelKey !== squash(artist)) return null;
  const parsed = parseArtistAndTitle(rawTitle, artist);
  const title = parsed.title.replace(/\s*[([]\s*(?:official(?:\s+music)?\s+video(?:\s+\d{4})?|official|video)\s*[)\]]\s*$/i, '').trim();
  return normalizeTitle(title) && normalizeTitle(title) !== artistKey ? title : null;
}

export async function assessOfficialYoutubeVideo(
  video: DiscoveredYoutubeVideo, artist: string,
): Promise<ClassificationResult & { songTitle?: string }> {
  try {
    const metadata = await getVideoMetadata(video.youtubeVideoId);
    const title = officialSongIdentity(metadata.title, metadata.channel, artist);
    // A newly inferred title is not an established song identity and must not
    // disable the classifier's fan-cover exclusion via expected-title exceptions.
    const classification = classifyCandidate(metadata);
    if (classification.decision === 'reject') return classification;
    if (!title) return { decision: 'review', reason: 'Official evidence found; artist/song identity remains uncertain.' };
    if (!hasOfficialKeyword(metadata.title) && !video.officialEvidence.some(e => e.startsWith('category:'))) {
      return { decision: 'review', reason: 'Official title evidence changed; confirm this song video.' };
    }
    const visual = await resolveReview(video.youtubeVideoId);
    return { ...visual, songTitle: title };
  } catch {
    return { decision: 'review', reason: 'Official evidence found; metadata could not be validated. Retry collection or review this video.' };
  }
}

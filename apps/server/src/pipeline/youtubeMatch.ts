import { searchYoutube, type YoutubeSearchCandidate } from '../providers/youtube/ytdlp.js';
import { normalizeTitle, squash } from './normalize.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A short/common song title ("Stand", "Blue", "Low") will match all sorts of
// unrelated YouTube content on title text alone — a real result must contain
// BOTH the song title (as a whole word/phrase, not a loose substring) AND
// something identifying the artist (in the title text, or the uploading
// channel's handle/name — official channels are often terse handles like
// "remhq" with no spaces, hence the squashed comparison).
function isPlausibleMatch(candidate: YoutubeSearchCandidate, artistName: string, title: string): boolean {
  const candidateTitleNorm = normalizeTitle(candidate.title);
  const titleNorm = normalizeTitle(title);
  const artistNorm = normalizeTitle(artistName);
  const channelSquash = squash(candidate.channel);
  const artistSquash = squash(artistName);

  const hasSongPhrase = titleNorm.length > 0 && new RegExp(`\\b${escapeRegex(titleNorm)}\\b`).test(candidateTitleNorm);
  const hasArtist =
    (artistNorm.length > 0 && candidateTitleNorm.includes(artistNorm)) ||
    (artistSquash.length > 0 && channelSquash.includes(artistSquash)) ||
    channelSquash.includes('vevo');

  return hasSongPhrase && hasArtist;
}

// Priority order per user: (1) the artist's own official channel/page, then
// (2) videos explicitly labeled "Official" — channel authority outranks title
// wording, since a random reuploader can put "Official Video" in a title too.
function score(candidate: YoutubeSearchCandidate, artistName: string): number {
  const titleLower = candidate.title.toLowerCase();
  const channelSquash = squash(candidate.channel);
  const artistSquash = squash(artistName);

  let s = 0;
  if (artistSquash.length > 0 && channelSquash === artistSquash) s += 6; // artist's own channel, exact
  else if (channelSquash.includes('vevo')) s += 5; // official VEVO distribution channel
  else if (artistSquash.length > 0 && channelSquash.includes(artistSquash)) s += 3; // e.g. "remhq"

  if (titleLower.includes('official music video')) s += 2;
  else if (titleLower.includes('official video')) s += 2;
  else if (titleLower.includes('official')) s += 1;

  if (titleLower.includes('lyric') || titleLower.includes('audio only')) s -= 3; // not a real music video
  return s;
}

// Returns the best plausible YouTube match for an artist/song, or null if
// nothing in the search results can be confidently tied to both the artist
// and the song — callers should fall back to another source in that case,
// not guess.
export async function findYoutubeMatch(
  artistName: string,
  title: string,
): Promise<YoutubeSearchCandidate | null> {
  const candidates = await searchYoutube(`${artistName} ${title} official video`);
  const plausible = candidates.filter((c) => isPlausibleMatch(c, artistName, title));
  if (!plausible.length) return null;

  return plausible.sort((a, b) => score(b, artistName) - score(a, artistName))[0];
}

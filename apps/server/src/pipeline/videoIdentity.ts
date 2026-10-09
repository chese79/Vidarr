import { artistNameHint, isUsableArtistHint } from './artistObservation.js';
import { normalizeTitle } from './normalize.js';

// A media server reports a video's "artist" from file metadata, which for ripped
// or downloaded videos is often the uploader's channel ("chunkletguy",
// "Domino Recording Co.") or "Unknown Artist" — never the artist the video is by.
// The file name, however, is usually "Artist - Title". This works out the likely
// real artist and title so a video can be matched to the catalog, trying the file
// name first and the server's own title second. It only proposes: the result still
// goes through the normal exact / fuzzy matching, and an unmatched video is never
// forced onto an artist.

export interface VideoIdentity {
  artistName: string;
  title: string;
  source: 'filename' | 'title' | 'metadata';
}

const VIDEO_EXTENSION = /\.(?:mp4|mkv|webm|m4v|avi|mov)$/i;
const DASH = /\s+[-–—]\s+/;

// Decorations that describe the upload rather than the song. Version labels that
// make a different video — "(Aphex Twin remix)", "(MTV Unplugged)", "(Live)" — are
// deliberately not here: dropping them would match the wrong video.
const NOISE_GROUP = /\s*[(\[]\s*(?:official(?:\s+(?:music|lyric|hd))?\s*(?:video|audio|version)?(?:\s+uncensored(?:\s+version)?)?|(?:full\s+)?(?:hq|hd|4k)(?:\s+sound)?|hi[\s-]*res|uncensored(?:\s+version)?|explicit|clean|remaster(?:ed)?(?:\s+\d{4})?|music\s+video|video|audio|lyrics?|(?:19|20)\d{2})\s*[)\]]\s*/gi;

// Base name of a path using either separator — the server may report a Windows
// path while Vidarr runs on Linux, so node:path cannot be trusted to split it.
export function fileStem(filePath: string | null | undefined): string {
  if (!filePath) return '';
  return (filePath.split(/[/\\]/).pop() ?? '').replace(VIDEO_EXTENSION, '').trim();
}

export function cleanVideoTitle(title: string): string {
  return title
    .replace(/_+/g, ' ')
    .replace(NOISE_GROUP, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Only after trimming: a removed tag leaves a space behind the closing quote.
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim();
}

// Names that are clearly fragments rather than an artist (a track number, a
// "(HD)" prefix, a path mangled by underscores) must not become artist records.
export function isPlausibleArtistName(name: string): boolean {
  const value = name.trim();
  return value.length > 0 && value.length <= 80 && !/^[(\[]/.test(value) && !value.includes('_') && !/^\d{1,3}$/.test(value);
}

type KnownArtists = { has(normalizedName: string): boolean };

// Splits "Artist - Title". Preference order: the longest left-hand side that is an
// artist already known to Vidarr (so "Florence + the Machine - Dog Days" and an
// artist whose own name contains " - " both work); the reverse "Title - Artist"
// when only the right-hand side is known; otherwise the first dash.
function splitArtistTitle(text: string, known: KnownArtists): { artist: string; title: string } | null {
  const stem = text.replace(/\s*\[[^\]]+\]\s*$/, '').replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
  const parts = stem.split(DASH);
  if (parts.length < 2) return null;
  let best: { artist: string; title: string } | null = null;
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join(' - ');
    if (known.has(normalizeTitle(artistNameHint(left))) && (!best || left.length > best.artist.length)) {
      best = { artist: left, title: parts.slice(i).join(' - ') };
    }
  }
  if (best) return best;
  const last = parts[parts.length - 1];
  if (known.has(normalizeTitle(artistNameHint(last)))) return { artist: last, title: parts.slice(0, -1).join(' - ') };
  return { artist: parts[0], title: parts.slice(1).join(' - ') };
}

// '"Submerge" by COME' and 'Cousteau: Talking to Myself' — less common shapes in
// a server's own title, accepted only where they are unambiguous.
function splitTitleOnly(title: string, known: KnownArtists): { artist: string; title: string } | null {
  const quoted = /^"([^"]+)"\s+by\s+(.+)$/i.exec(title.trim());
  if (quoted) return { artist: quoted[2].trim(), title: quoted[1].trim() };
  const colon = /^([^:]{2,60}):\s+(.+)$/.exec(title.trim());
  if (colon && known.has(normalizeTitle(artistNameHint(colon[1])))) return { artist: colon[1].trim(), title: colon[2].trim() };
  return splitArtistTitle(title, known);
}

// Ordered, de-duplicated candidates for one server video: file name, then the
// server's title, then the server's artist/title as given. `known` is the set of
// normalized artist names Vidarr already has.
export function videoIdentities(
  video: { title: string; artistName: string; path?: string | null },
  known: KnownArtists,
): VideoIdentity[] {
  const out: VideoIdentity[] = [];
  const seen = new Set<string>();
  const add = (artistName: string, title: string, source: VideoIdentity['source']) => {
    const hinted = artistNameHint(artistName);
    const cleaned = cleanVideoTitle(title);
    const key = `${normalizeTitle(hinted)}|${normalizeTitle(cleaned)}`;
    if (!normalizeTitle(hinted) || !normalizeTitle(cleaned) || seen.has(key)) return;
    seen.add(key);
    out.push({ artistName: hinted, title: cleaned, source });
  };

  const fromFile = splitArtistTitle(fileStem(video.path), known);
  if (fromFile) add(fromFile.artist, fromFile.title, 'filename');
  const fromTitle = splitTitleOnly(video.title, known);
  if (fromTitle) add(fromTitle.artist, fromTitle.title, 'title');
  add(video.artistName, video.title, 'metadata');
  return out;
}

// The artist worth recording as an observation for a video, or null: the first
// candidate that looks like an artist. Parsed (file name / title) identities come
// first; the server's own artist is only reached when nothing could be parsed, which
// is how every video was treated before parsing existed.
export function observedArtistName(identities: VideoIdentity[]): string | null {
  for (const identity of identities) {
    if (isUsableArtistHint(identity.artistName) && isPlausibleArtistName(identity.artistName)) return identity.artistName;
  }
  return null;
}

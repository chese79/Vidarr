import { normalizeTitle } from './normalize.js';
import { searchMusicBrainzArtists } from '../providers/metadata/musicbrainz.js';

export interface NewArtistValidation {
  validated: boolean;
  sources: string[];
  musicbrainzArtistId: string | null;
  imvdbArtistId: string | null;
  warnings: string[];
}
const cache = new Map<string, { at: number; result: NewArtistValidation }>();

// Ambiguous names must be resolved through the MusicBrainz identity picker.
export async function validateNewArtist(name: string): Promise<NewArtistValidation> {
  const key = normalizeTitle(name);
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < 60_000 && process.env.NODE_ENV !== 'test') return previous.result;
  let result: NewArtistValidation;
  try {
    const matches = (await searchMusicBrainzArtists(name, 20)).filter((a) =>
      normalizeTitle(a.name) === key || a.aliases.some((alias) => normalizeTitle(alias) === key));
    result = { validated: matches.length === 1, sources: matches.length ? ['MusicBrainz'] : [],
      musicbrainzArtistId: matches.length === 1 ? matches[0].id : null, imvdbArtistId: null,
      warnings: matches.length > 1 ? ['Several MusicBrainz artists have this name; select the correct identity using MusicBrainz search.']
        : matches.length === 0 ? ['No matching MusicBrainz artist found. Check the spelling or use MusicBrainz search.'] : [] };
  } catch {
    result = { validated: false, sources: [], musicbrainzArtistId: null, imvdbArtistId: null, warnings: ['MusicBrainz could not be checked. Try again later.'] };
  }
  if (cache.size >= 100) cache.clear();
  cache.set(key, { at: Date.now(), result });
  return result;
}

import { prisma } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { searchMusicBrainzArtists } from '../providers/metadata/musicbrainz.js';
import { findPublicArtistSlug, searchArtists } from '../providers/metadata/imvdb.js';

export interface NewArtistValidation {
  validated: boolean;
  sources: string[];
  musicbrainzArtistId: string | null;
  imvdbArtistId: string | null;
  warnings: string[];
}

const cache = new Map<string, { at: number; result: NewArtistValidation }>();

// Name validation is separate from canonical MusicBrainz identity confirmation.
// Provider failures never count as validation and are explained in the warning.
export async function validateNewArtist(name: string): Promise<NewArtistValidation> {
  const key = normalizeTitle(name);
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < 60_000 && process.env.NODE_ENV !== 'test') return previous.result;
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const lastfm = await prisma.recommendationProviderConfig.findUnique({ where: { provider: 'lastfm' } });
  const checks = await Promise.allSettled([
    searchMusicBrainzArtists(name, 20),
    (async () => {
      if (!lastfm?.apiKey) return null;
      const url = new URL('https://ws.audioscrobbler.com/2.0/');
      url.search = new URLSearchParams({ method: 'artist.getinfo', artist: name, autocorrect: '0', api_key: lastfm.apiKey, format: 'json' }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Last.fm check failed');
      const body = await response.json() as { error?: number; artist?: { name?: string } };
      if (body.error && body.error !== 6) throw new Error('Last.fm check failed');
      return !body.error && body.artist?.name && normalizeTitle(body.artist.name) === key ? body.artist.name : null;
    })(),
    (async () => {
      if (settings?.imvdbApiKey) {
        const matches = (await searchArtists(settings.imvdbApiKey, name)).filter((a) => normalizeTitle(a.name) === key);
        if (matches.length === 1) return matches[0].slug;
      }
      return findPublicArtistSlug(name);
    })(),
  ]);
  const [mb, lf, im] = checks;
  const matches = mb.status === 'fulfilled' ? mb.value.filter((a) => normalizeTitle(a.name) === key) : [];
  const sources = [matches.length ? 'MusicBrainz' : null, lf.status === 'fulfilled' && lf.value ? 'Last.fm' : null, im.status === 'fulfilled' && im.value ? 'IMVDb' : null].filter((s): s is string => Boolean(s));
  const warnings = checks.flatMap((result, i) => result.status === 'rejected' ? [`${['MusicBrainz', 'Last.fm', 'IMVDb'][i]} could not be checked.`] : []);
  if (!lastfm?.apiKey) warnings.push('Last.fm API key is not configured.');
  if (matches.length > 1) warnings.push('Several MusicBrainz artists have this name; choose the identity in Artist Review.');
  const result = { validated: sources.length > 0, sources, musicbrainzArtistId: matches.length === 1 ? matches[0].id : null,
    imvdbArtistId: im.status === 'fulfilled' ? im.value : null, warnings };
  if (cache.size >= 100) cache.clear();
  cache.set(key, { at: Date.now(), result });
  return result;
}

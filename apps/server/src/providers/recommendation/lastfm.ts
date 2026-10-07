import type { RecommendationProvider, SimilarArtistHit } from './types.js';

const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';

export function createLastFmProvider(apiKey: string): RecommendationProvider {
  async function call(params: Record<string, string>): Promise<any | null> {
    const url = new URL(LASTFM_API);
    for (const [key, value] of Object.entries({ ...params, api_key: apiKey, format: 'json' })) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return res.json();
  }

  return {
    async getSimilarArtists(seedArtistNames: string[]): Promise<SimilarArtistHit[]> {
      const hits: SimilarArtistHit[] = [];
      for (const seed of seedArtistNames) {
        const url = new URL(LASTFM_API);
        url.searchParams.set('method', 'artist.getsimilar');
        url.searchParams.set('artist', seed);
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('format', 'json');
        url.searchParams.set('limit', '20');

        const res = await fetch(url);
        if (!res.ok) continue;
        const body = await res.json();
        const similar: any[] = body?.similarartists?.artist ?? [];
        for (const a of similar) {
          hits.push({
            name: a.name as string,
            score: Number(a.match ?? 0),
            sourceRef: a.mbid || undefined,
            seedArtistName: seed,
            reason: `Similar to ${seed} (Last.fm)`,
          });
        }
      }
      return hits;
    },

    // Last.fm's top tags for an artist, each with a 0-100 weight relative to the
    // artist's strongest tag. Free text (decades, nationalities, "female
    // vocalists" appear alongside genres), so callers must filter. A MusicBrainz
    // ID is the most precise lookup, but Last.fm returns an empty tag list rather
    // than an error when it does not know the ID — so an empty result falls back
    // to the name instead of being trusted.
    async getArtistTags(artist: { name: string; mbid?: string | null }) {
      const parse = (body: any) => ((body?.toptags?.tag ?? []) as any[])
        .map((tag) => ({ name: String(tag.name), count: Number(tag.count ?? 0) }))
        .filter((tag) => tag.name);
      if (artist.mbid) {
        const byId = parse(await call({ method: 'artist.gettoptags', mbid: artist.mbid }));
        if (byId.length) return byId;
      }
      return parse(await call({ method: 'artist.gettoptags', artist: artist.name, autocorrect: '1' }));
    },
  };
}

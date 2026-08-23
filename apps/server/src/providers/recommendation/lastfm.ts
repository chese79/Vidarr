import type { RecommendationProvider, SimilarArtistHit } from './types.js';

const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';

export function createLastFmProvider(apiKey: string): RecommendationProvider {
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
  };
}

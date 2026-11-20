import type { RecommendationProvider, SimilarArtistHit } from './types.js';
import { musicBrainzRequest as mbGet } from '../metadata/musicBrainzTransport.js';

async function resolveMbid(name: string): Promise<string | null> {
  const body = await mbGet(`/artist/?query=${encodeURIComponent(`artist:${name}`)}&fmt=json`);
  return body?.artists?.[0]?.id ?? null;
}

async function getArtistTags(mbid: string): Promise<{ name: string; count: number }[]> {
  const body = await mbGet(`/artist/${mbid}?inc=tags&fmt=json`);
  return (body?.tags ?? []).map((t: any) => ({ name: t.name as string, count: Number(t.count ?? 1) }));
}

async function searchArtistsByTag(tag: string, limit: number): Promise<{ name: string; id: string }[]> {
  const body = await mbGet(
    `/artist?query=${encodeURIComponent(`tag:${tag}`)}&limit=${limit}&fmt=json`,
  );
  return (body?.artists ?? []).map((a: any) => ({ name: a.name as string, id: a.id as string }));
}

const TOP_TAGS = 5;
const CANDIDATES_PER_TAG = 15;

export function createMusicBrainzProvider(): RecommendationProvider {
  return {
    async getSimilarArtists(seedArtistNames: string[]): Promise<SimilarArtistHit[]> {
      const tagWeight = new Map<string, number>();
      const tagSeed = new Map<string, string>();

      for (const seed of seedArtistNames) {
        const mbid = await resolveMbid(seed);
        if (!mbid) continue;
        const tags = await getArtistTags(mbid);
        for (const tag of tags) {
          tagWeight.set(tag.name, (tagWeight.get(tag.name) ?? 0) + tag.count);
          if (!tagSeed.has(tag.name)) tagSeed.set(tag.name, seed);
        }
      }

      const topTags = [...tagWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TAGS);
      if (!topTags.length) return [];
      const maxWeight = topTags[0][1];

      const hits: SimilarArtistHit[] = [];
      for (const [tag, weight] of topTags) {
        const candidates = await searchArtistsByTag(tag, CANDIDATES_PER_TAG);
        const seed = tagSeed.get(tag) ?? seedArtistNames[0];
        for (const candidate of candidates) {
          hits.push({
            name: candidate.name,
            score: weight / maxWeight,
            sourceRef: candidate.id,
            seedArtistName: seed,
            reason: `Shares tag "${tag}" with ${seed} (MusicBrainz)`,
          });
        }
      }
      return hits;
    },
  };
}

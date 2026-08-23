import type { RecommendationProvider, SimilarArtistHit } from './types.js';

const MB_API = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'vidarr/0.1.0 (self-hosted music video manager)';
const MIN_REQUEST_INTERVAL_MS = 1100; // MusicBrainz requires <= 1 req/sec

let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  queue = run;
  return run.then(fn);
}

async function mbGet(path: string): Promise<any> {
  return rateLimited(async () => {
    const res = await fetch(`${MB_API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`MusicBrainz request failed: ${res.status}`);
    return res.json();
  });
}

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

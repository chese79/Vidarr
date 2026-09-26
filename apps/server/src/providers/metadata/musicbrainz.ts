import { normalizeTitle } from '../../pipeline/normalize.js';

const API_BASE = 'https://musicbrainz.org/ws/2';
const MIN_REQUEST_INTERVAL_MS = 1_100;
let requestChain = Promise.resolve();
let lastRequestAt = 0;

export interface MusicBrainzArtist {
  id: string;
  name: string;
  sortName: string;
  type: string | null;
  country: string | null;
  disambiguation: string | null;
  genres: string[];
  aliases: string[];
  score?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedGet(path: string): Promise<any> {
  let release!: () => void;
  const previous = requestChain;
  requestChain = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const delay = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (delay) await sleep(delay);
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Vidarr/0.1 (https://github.com/chese79/Vidarr)',
      },
      signal: AbortSignal.timeout(15_000),
    });
    lastRequestAt = Date.now();
    if (!response.ok) throw new Error(`MusicBrainz request failed: ${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    release();
  }
}

function mapArtist(value: any): MusicBrainzArtist {
  return {
    id: String(value.id),
    name: String(value.name ?? ''),
    sortName: String(value['sort-name'] ?? value.name ?? ''),
    type: value.type ?? null,
    country: value.country ?? null,
    disambiguation: value.disambiguation ?? null,
    genres: (value.genres ?? []).map((genre: any) => String(genre.name)),
    aliases: (value.aliases ?? []).map((alias: any) => String(alias.name)),
    score: typeof value.score === 'number' ? value.score : undefined,
  };
}

export async function lookupMusicBrainzArtist(mbid: string): Promise<MusicBrainzArtist> {
  const value = await rateLimitedGet(`/artist/${encodeURIComponent(mbid)}?fmt=json&inc=aliases+genres`);
  return mapArtist(value);
}

function escapeLucene(value: string): string {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

export async function searchMusicBrainzArtists(name: string, limit = 5): Promise<MusicBrainzArtist[]> {
  const query = encodeURIComponent(`artist:"${escapeLucene(name)}"`);
  const body = await rateLimitedGet(`/artist?query=${query}&limit=${limit}&fmt=json`);
  return (body.artists ?? []).map(mapArtist);
}

export interface MusicBrainzVideoRecording {
  id: string;
  title: string;
  releaseYear: number | null;
  audioRecordingId: string | null;
  sources: Array<{ provider: string; url: string; externalId: string | null }>;
}

export async function getMusicBrainzVideoRecordings(artistMbid: string): Promise<MusicBrainzVideoRecording[]> {
  const results: MusicBrainzVideoRecording[] = [];
  for (let offset = 0; ; offset += 100) {
    const body = await rateLimitedGet(
      `/recording?artist=${encodeURIComponent(artistMbid)}&limit=100&offset=${offset}&fmt=json&inc=recording-rels+url-rels`,
    );
    const recordings: any[] = body.recordings ?? [];
    for (const recording of recordings) {
      const relations: any[] = recording.relations ?? [];
      const musicVideoRelation = relations.find((relation) => relation.type === 'music video' && relation.recording?.id);
      const videoUrls = relations.filter((relation) =>
        relation.url?.resource && (relation.attributes ?? []).some((attribute: string) => attribute.toLowerCase() === 'video'),
      );
      if (recording.video !== true && !musicVideoRelation && videoUrls.length === 0) continue;
      const sources = videoUrls.map((relation) => {
        const url = String(relation.url.resource);
        const youtube = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([\w-]{11})/i);
        return { provider: youtube ? 'youtube' : 'web', url, externalId: youtube?.[1] ?? null };
      });
      results.push({
        id: String(recording.id),
        title: String(recording.title),
        releaseYear: /^\d{4}/.test(recording['first-release-date'] ?? '') ? Number(String(recording['first-release-date']).slice(0, 4)) : null,
        audioRecordingId: musicVideoRelation ? String(musicVideoRelation.recording.id) : null,
        sources,
      });
    }
    if (recordings.length < 100 || offset + recordings.length >= Number(body['recording-count'] ?? 0)) break;
  }
  return results;
}

export interface ArtistMatchAssessment {
  confidence: number;
  exactName: boolean;
  supportingEvidence: string[];
}

// MusicBrainz's search score is useful for candidate ordering but must not be
// treated as identity confirmation. Exact canonical/alias name plus separate
// evidence can be auto-confirmed; exact name alone remains a review proposal.
export function assessArtistCandidate(
  observedName: string,
  candidate: MusicBrainzArtist,
  evidence: { country?: string | null; artistType?: string | null; genre?: string | null } = {},
): ArtistMatchAssessment {
  const observed = normalizeTitle(observedName);
  const exactName = [candidate.name, ...candidate.aliases].some((name) => normalizeTitle(name) === observed);
  const supportingEvidence: string[] = [];
  if (evidence.country && candidate.country && evidence.country.toLowerCase() === candidate.country.toLowerCase()) supportingEvidence.push('country');
  if (evidence.artistType && candidate.type && evidence.artistType.toLowerCase() === candidate.type.toLowerCase()) supportingEvidence.push('artistType');
  if (evidence.genre && candidate.genres.some((genre) => normalizeTitle(genre) === normalizeTitle(evidence.genre!))) supportingEvidence.push('genre');
  const searchScore = Math.max(0, Math.min(1, (candidate.score ?? 0) / 100));
  const confidence = Math.min(0.99, (exactName ? 0.82 : searchScore * 0.7) + supportingEvidence.length * 0.08);
  return { confidence, exactName, supportingEvidence };
}

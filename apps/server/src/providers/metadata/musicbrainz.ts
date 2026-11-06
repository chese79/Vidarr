import { normalizeTitle, squash } from '../../pipeline/normalize.js';

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
  // Same genres with MusicBrainz's community vote counts, highest first.
  genreVotes?: Array<{ name: string; votes: number }>;
  aliases: string[];
  youtubeChannels?: string[];
  imvdbSlug?: string | null;
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

export function mapArtist(value: any): MusicBrainzArtist {
  const youtubeChannels = (value.relations ?? [])
    .filter((relation: any) => ['6a540e5b-58c6-4192-b6ba-dbc71ec8fcf0', '631712a0-7525-42ba-b7a3-605aa7a238c4'].includes(String(relation['type-id'] ?? '').toLowerCase()))
    .map((relation: any) => String(relation.url?.resource ?? ''))
    .filter((url: string) => /^https:\/\/(?:www\.|music\.)?youtube\.com\/(?:channel\/|user\/|c\/|@)/i.test(url));
  const imvdbSlug = (value.relations ?? [])
    .map((relation: any) => String(relation.url?.resource ?? ''))
    .map((url: string) => /^https?:\/\/(?:www\.)?imvdb\.com\/n\/([a-z0-9._-]+)\/?(?:[?#].*)?$/i.exec(url)?.[1] ?? null)
    .find((slug: string | null) => slug !== null) ?? null;
  return {
    id: String(value.id),
    name: String(value.name ?? ''),
    sortName: String(value['sort-name'] ?? value.name ?? ''),
    type: value.type ?? null,
    country: value.country ?? null,
    disambiguation: value.disambiguation ?? null,
    genres: (value.genres ?? []).map((genre: any) => String(genre.name)),
    genreVotes: (value.genres ?? [])
      .map((genre: any) => ({ name: String(genre.name), votes: Number(genre.count ?? 0) }))
      .sort((a: { votes: number }, b: { votes: number }) => b.votes - a.votes),
    aliases: (value.aliases ?? []).map((alias: any) => String(alias.name)),
    youtubeChannels,
    imvdbSlug,
    score: typeof value.score === 'number' ? value.score : undefined,
  };
}

export async function lookupMusicBrainzArtist(mbid: string): Promise<MusicBrainzArtist> {
  const value = await rateLimitedGet(`/artist/${encodeURIComponent(mbid)}?fmt=json&inc=aliases+genres+url-rels`);
  return mapArtist(value);
}

export interface LiveReference {
  id: string; title: string; url: string; rank: number;
  releaseDate: string | null; primaryType: string | null;
  eventDate?: string | null;
}

export async function searchLiveSongEvidence(mbid: string, song: string) {
  const query = `arid:${mbid} AND recording:"${escapeLucene(song)}"`;
  const body = await rateLimitedGet(`/recording?query=${encodeURIComponent(query)}&limit=10&fmt=json`);
  return (body.recordings ?? []).filter((row: any) => (row['artist-credit'] ?? []).some((credit: any) => credit.artist?.id === mbid))
    .map((row: any) => ({ id: String(row.id), title: String(row.title), url: `https://musicbrainz.org/recording/${row.id}` })) as Array<{ id: string; title: string; url: string }>;
}

export async function lookupLiveEventEvidence(id: string, mbid: string) {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('Invalid MusicBrainz event identity');
  const body = await rateLimitedGet(`/event/${id}?inc=artist-rels+place-rels&fmt=json`);
  if (body.id !== id || !(body.relations ?? []).some((rel: any) => rel.artist?.id === mbid && ['main performer', 'guest performer'].includes(rel.type))) return null;
  const place = (body.relations ?? []).find((rel: any) => rel.type === 'held at' && rel.place?.name)?.place;
  return { id, title: String(body.name), url: `https://musicbrainz.org/event/${id}`, date: body['life-span']?.begin as string | undefined,
    venue: place?.name as string | undefined, city: (place?.area?.name ?? place?.['begin-area']?.name) as string | undefined };
}
// One bounded reference page, not the artist's event history or audio discography.
// Website-default excludes groups containing only bootleg/pseudo/promotional releases.
export async function getMusicBrainzLiveReferences(mbid: string): Promise<LiveReference[]> {
  const body = await rateLimitedGet(`/release-group?artist=${encodeURIComponent(mbid)}&type=live&release-group-status=website-default&limit=100&fmt=json&inc=artist-credits+ratings`);
  return (body['release-groups'] ?? []).filter((group: any) =>
    group['secondary-types']?.includes('Live') && (group['artist-credit'] ?? []).some((credit: any) => credit.artist?.id === mbid)
  ).map((group: any) => ({ id: String(group.id), title: String(group.title),
    url: `https://musicbrainz.org/release-group/${group.id}`, releaseDate: group['first-release-date'] || null,
    primaryType: group['primary-type'] ?? null,
    rank: ({ Album: 100, Broadcast: 80, EP: 60 } as Record<string, number>)[group['primary-type']] ?? 40,
  }));
}

export async function getMusicBrainzLiveEventReferences(mbid: string): Promise<LiveReference[]> {
  const body = await rateLimitedGet(`/artist/${encodeURIComponent(mbid)}?fmt=json&inc=event-rels`);
  if (body.id !== mbid) throw new Error('MusicBrainz returned a different artist identity');
  return (body.relations ?? []).filter((rel: any) => rel.event?.id && ['main performer', 'guest performer'].includes(rel.type)).slice(0, 100)
    .map((rel: any) => ({ id: String(rel.event.id), title: String(rel.event.name),
      url: `https://musicbrainz.org/event/${rel.event.id}`, releaseDate: null, primaryType: 'Event',
      // Event dates remain provider evidence until review, including broadcast/rebroadcast dates.
      rank: /brit awards|tiny desk/i.test(rel.event.name) ? 75 : 50,
      eventDate: rel.event['life-span']?.begin ?? null,
    }));
}

function escapeLucene(value: string): string {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

// Bounded album evidence, separate from video discovery and catalog admission.
export async function enrichmentAlbumEvidence(artistId: string, title: string, recordingId?: string, releaseId?: string) {
  const valid = (value?: string) => !!value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  if (!valid(artistId)) return [];
  const search = async (hint: string) => (await rateLimitedGet(`/recording?query=${encodeURIComponent(`arid:${artistId} AND recording:"${escapeLucene(hint)}"`)}&limit=5&fmt=json`)).recordings ?? [];
  const credited = (rows: any[], hint: string) => rows.filter((row: any) => (!valid(recordingId) || row.id === recordingId) && (row['artist-credit'] ?? []).some((credit: any) => credit.artist?.id === artistId)
    && (valid(recordingId) || String(row.title).trim().toLocaleLowerCase() === hint.trim().toLocaleLowerCase()));
  const recordings = valid(recordingId) ? [await rateLimitedGet(`/recording/${recordingId}?inc=artist-credits+releases&fmt=json`)] : await search(title);
  let exact = credited(recordings, title);
  let versionHint = false;
  if (!valid(recordingId) && exact.length === 0) {
    const baseTitle = title.replace(/\s*[(\[][^)\]]*\b(?:remix|mix|edit|live|version)\b[^)\]]*[)\]]\s*$/i, '').trim();
    if (baseTitle && baseTitle !== title.trim()) { exact = credited(await search(baseTitle), baseTitle); versionHint = true; }
  }
  const result: Array<{ album: string; albumYear?: number; recordLabel?: string; recordingId: string; releaseId: string; verified: boolean; reason: string }> = [];
  for (const recording of exact.slice(0, 2)) {
    const releases = valid(releaseId) ? [{ id: releaseId }] : (recording.releases ?? []).slice(0, 3);
    for (const ref of releases) {
      const release = await rateLimitedGet(`/release/${encodeURIComponent(ref.id)}?inc=artist-credits+labels+recordings+release-groups&fmt=json`);
      if (release.id !== ref.id) throw new Error('MusicBrainz returned a different release identity');
      if (!(release['artist-credit'] ?? []).some((credit: any) => credit.artist?.id === artistId)) continue;
      if (!(release.media ?? []).some((medium: any) => (medium.tracks ?? []).some((track: any) => track.recording?.id === recording.id))) continue;
      const date = release.date; const year = typeof date === 'string' && /^\d{4}(?:-|$)/.test(date) ? Number(date.slice(0, 4)) : undefined;
      const labels: string[] = [...new Set<string>((release['label-info'] ?? []).map((entry: any) => entry.label?.name).filter(Boolean))];
      result.push({ album: String(release.title), albumYear: year, recordLabel: labels.length === 1 ? labels[0] : undefined,
        recordingId: recording.id, releaseId: release.id, verified: valid(recordingId) && valid(releaseId),
        reason: valid(recordingId) && valid(releaseId) ? 'Embedded recording and release IDs with matching artist credit and track.' : `${versionHint ? 'Version suffix omitted for search suggestions only. ' : ''}Recording/release edition needs review; title matching alone cannot establish this video version.` });
    }
  }
  return result;
}

export async function searchMusicBrainzArtists(name: string, limit = 5): Promise<MusicBrainzArtist[]> {
  const query = encodeURIComponent(`artist:"${escapeLucene(name)}"`);
  const body = await rateLimitedGet(`/artist?query=${query}&limit=${limit}&fmt=json`);
  return (body.artists ?? []).map(mapArtist);
}

export async function lookupRecordingArtistIds(recordingId: string): Promise<string[]> {
  const body = await rateLimitedGet(`/recording/${encodeURIComponent(recordingId)}?fmt=json&inc=artist-credits`);
  const credits: Array<{ artist?: { id?: unknown } }> = body['artist-credit'] ?? [];
  return [...new Set(credits
    .map((credit) => credit.artist?.id)
    .filter((id): id is string => typeof id === 'string'))];
}

export async function lookupReleaseArtistIds(releaseId: string): Promise<string[]> {
  const body = await rateLimitedGet(`/release/${encodeURIComponent(releaseId)}?fmt=json&inc=artist-credits`);
  const credits: Array<{ artist?: { id?: unknown } }> = body['artist-credit'] ?? [];
  return [...new Set(credits
    .map((credit) => credit.artist?.id)
    .filter((id): id is string => typeof id === 'string'))];
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
  recordingMatchCount: number;
  releaseMatchCount: number;
}

// MusicBrainz's search score is useful for candidate ordering but must not be
// treated as identity confirmation. Exact canonical/alias name plus separate
// evidence can be auto-confirmed; exact name alone remains a review proposal.
export function assessArtistCandidate(
  observedName: string,
  candidate: MusicBrainzArtist,
  evidence: { country?: string | null; artistType?: string | null; genre?: string | null; recordingMatchCount?: number; releaseMatchCount?: number } = {},
): ArtistMatchAssessment {
  const observed = observedName.split(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+/i, 1)[0].trim();
  const exactName = [candidate.name, ...candidate.aliases].some((name) =>
    normalizeTitle(name) === normalizeTitle(observed) || squash(name) === squash(observed));
  const supportingEvidence: string[] = [];
  if (evidence.country && candidate.country && evidence.country.toLowerCase() === candidate.country.toLowerCase()) supportingEvidence.push('country');
  if (evidence.artistType && candidate.type && evidence.artistType.toLowerCase() === candidate.type.toLowerCase()) supportingEvidence.push('artistType');
  if (evidence.genre && candidate.genres.some((genre) => normalizeTitle(genre) === normalizeTitle(evidence.genre!))) supportingEvidence.push('genre');
  const recordingMatchCount = Math.max(0, evidence.recordingMatchCount ?? 0);
  const releaseMatchCount = Math.max(0, evidence.releaseMatchCount ?? 0);
  if (recordingMatchCount > 0) supportingEvidence.push('observed-recording-credit');
  if (releaseMatchCount > 0) supportingEvidence.push('observed-release-credit');
  const searchScore = Math.max(0, Math.min(1, (candidate.score ?? 0) / 100));
  const confidence = Math.min(0.99, (exactName ? 0.82 : searchScore * 0.7)
    + supportingEvidence.filter((source) => source !== 'observed-recording-credit' && source !== 'observed-release-credit').length * 0.08
    + Math.min(recordingMatchCount + releaseMatchCount, 2) * 0.08);
  return { confidence, exactName, supportingEvidence, recordingMatchCount, releaseMatchCount };
}

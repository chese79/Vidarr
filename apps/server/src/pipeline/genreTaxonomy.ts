import { MUSICBRAINZ_GENRES } from '../data/musicbrainzGenres.js';

// MusicBrainz's genre vocabulary is flat: "rock" and "post-hardcore" are peers.
// Vidarr shows two levels so a user can judge how fragmented their library is,
// so this module derives a broad genre ("parent") for each name. The mapping is
// a deliberately simple heuristic (last recognised word of the name, plus a
// small override table) — it exists to group, not to be musicological truth,
// and an unrecognised name simply has no parent rather than a wrong one.

export type GenreLevel = 'genre' | 'subgenre';

export interface ClassifiedGenre {
  name: string;
  level: GenreLevel;
  // Broad genre a sub-genre rolls up into; null for broad genres themselves and
  // for sub-genres whose parent we cannot infer.
  parent: string | null;
  // Whether the name is in the MusicBrainz vocabulary. Free-text values (a user
  // typing their own, or a connector's) are kept but flagged.
  official: boolean;
}

export const BROAD_GENRES: readonly string[] = [
  'rock', 'pop', 'hip hop', 'electronic', 'dance', 'r&b', 'jazz', 'blues', 'country',
  'folk', 'metal', 'punk', 'reggae', 'classical', 'latin', 'gospel', 'experimental',
];
const BROAD = new Set(BROAD_GENRES);
const OFFICIAL = new Set(MUSICBRAINZ_GENRES);

// Spelling variants people (and Last.fm's free-text tags) use for a genre that
// MusicBrainz names differently. Every target must be in the vocabulary — the
// unit test enforces that so a vocabulary refresh cannot silently orphan one.
const ALIASES: Record<string, string> = {
  rnb: 'r&b',
  'r and b': 'r&b',
  'r&b/soul': 'r&b',
  'rhythm and blues': 'r&b',
  rap: 'hip hop',
  'hip-hop': 'hip hop',
  hiphop: 'hip hop',
  'hip hop/rap': 'hip hop',
  'hip-hop/rap': 'hip hop',
  'pop/rock': 'pop rock',
  'singer/songwriter': 'singer-songwriter',
  'drum n bass': 'drum and bass',
  'drum & bass': 'drum and bass',
  dnb: 'drum and bass',
  'rock & roll': 'rock and roll',
  "rock'n'roll": 'rock and roll',
  'rock n roll': 'rock and roll',
  kpop: 'k-pop',
  jpop: 'j-pop',
};

// Looser than ALIASES: names that differ only in spacing/punctuation
// ("synthpop" / "synth-pop", "hip hop" / "hip-hop") resolve to the vocabulary's
// own spelling. First entry wins on the rare collision (e.g. "hyper techno" and
// "hypertechno" both exist upstream), and the list is sorted so that is stable.
const keyOf = (value: string) => value.replace(/[^a-z0-9]/g, '');
const OFFICIAL_BY_KEY = new Map<string, string>();
for (const genre of MUSICBRAINZ_GENRES) {
  const key = keyOf(genre);
  if (key && !OFFICIAL_BY_KEY.has(key)) OFFICIAL_BY_KEY.set(key, genre);
}

const WORD_PARENT: Record<string, string> = {
  rock: 'rock', grunge: 'rock', shoegaze: 'rock', emo: 'rock', indie: 'rock',
  pop: 'pop', popular: 'pop',
  metal: 'metal',
  punk: 'punk', hardcore: 'punk',
  jazz: 'jazz', bebop: 'jazz', swing: 'jazz',
  folk: 'folk', americana: 'folk', bluegrass: 'country',
  country: 'country',
  blues: 'blues',
  reggae: 'reggae', ska: 'reggae', dancehall: 'reggae', dub: 'reggae',
  classical: 'classical', opera: 'classical', baroque: 'classical', orchestral: 'classical',
  chamber: 'classical', symphony: 'classical',
  rap: 'hip hop', trap: 'hip hop', grime: 'hip hop', hip: 'hip hop', drill: 'hip hop',
  soul: 'r&b', funk: 'r&b', 'r&b': 'r&b', motown: 'r&b',
  disco: 'dance', dance: 'dance', edm: 'dance', eurodance: 'dance',
  house: 'electronic', techno: 'electronic', trance: 'electronic', ambient: 'electronic',
  electro: 'electronic', electronica: 'electronic', electronic: 'electronic', idm: 'electronic',
  dubstep: 'electronic', glitch: 'electronic', downtempo: 'electronic', synthwave: 'electronic',
  chillwave: 'electronic', industrial: 'electronic', breakbeat: 'electronic', garage: 'electronic',
  jungle: 'electronic', bass: 'electronic', beat: 'electronic', vaporwave: 'electronic',
  latin: 'latin', salsa: 'latin', reggaeton: 'latin', bachata: 'latin', cumbia: 'latin',
  gospel: 'gospel',
  experimental: 'experimental', noise: 'experimental',
};

// Whole-name overrides where the last-word rule would be wrong or silent.
const NAME_PARENT: Record<string, string> = {
  'trip hop': 'electronic',
  'drum and bass': 'electronic',
  'big beat': 'electronic',
  'new wave': 'pop',
  'synth-pop': 'pop',
  'k-pop': 'pop',
  'j-pop': 'pop',
  'singer-songwriter': 'folk',
  'easy listening': 'pop',
  'rock and roll': 'rock',
  'new age': 'electronic',
  'bossa nova': 'jazz',
  'hip house': 'electronic',
};

export function normalizeGenreName(raw: string): string {
  const cleaned = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!]+|[\s.,;:!]+$/g, '');
  if (!cleaned) return '';
  if (ALIASES[cleaned]) return ALIASES[cleaned];
  if (OFFICIAL.has(cleaned)) return cleaned;
  return OFFICIAL_BY_KEY.get(keyOf(cleaned)) ?? cleaned;
}

export function isOfficialGenre(name: string): boolean {
  return OFFICIAL.has(name);
}

export function classifyGenre(raw: string): ClassifiedGenre | null {
  const name = normalizeGenreName(raw);
  if (!name) return null;
  const official = OFFICIAL.has(name);
  if (BROAD.has(name)) return { name, level: 'genre', parent: null, official };
  let parent: string | null = NAME_PARENT[name] ?? null;
  if (!parent) {
    const words = name.split(/[\s\-/]+/).filter(Boolean);
    for (let i = words.length - 1; i >= 0 && !parent; i--) parent = WORD_PARENT[words[i]] ?? null;
  }
  return { name, level: 'subgenre', parent: parent === name ? null : parent, official };
}

// Splits a stored/typed list ("Rock, Alt Rock; pop") into distinct normalised
// names, preserving order. Used for the legacy comma-separated Artist.genre
// column and for user input.
export function parseGenreList(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;]/)) {
    const name = normalizeGenreName(part);
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

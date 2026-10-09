import { prisma, logActivity } from '../db/client.js';
import { lookupMusicBrainzArtist } from '../providers/metadata/musicbrainz.js';
import { getEnabledProviders } from './recommendations.js';
import { BROAD_GENRES, classifyGenre, parseGenreList, type GenreLevel } from './genreTaxonomy.js';

// Where a genre value came from. Several sources are stored side by side
// (ArtistGenre rows) so the user can see and judge them; `selectEffective`
// decides which ones are in force.
export type GenreSource = 'user' | 'embedded' | 'connector' | 'musicbrainz' | 'lastfm';

export interface GenreRow {
  name: string;
  level: GenreLevel;
  parent: string | null;
  source: GenreSource;
  votes: number | null;
  // Derived from the legacy Artist.genre string rather than stored.
  virtual?: boolean;
}

export interface EffectiveGenre {
  name: string;
  level: GenreLevel;
  parent: string | null;
  sources: GenreSource[];
  score: number;
}

// Precedence from docs/product-vision.md: the user's value, then genres embedded
// in the user's own files or reported by their media server, then the community
// sources — MusicBrainz and Last.fm are peers and are merged, not ranked.
const TIER: Record<GenreSource, number> = { user: 0, embedded: 1, connector: 1, musicbrainz: 2, lastfm: 2 };

// MusicBrainz alone can attach a dozen genres to a well-known artist; only the
// strongest are put in force. The rest remain visible as alternatives.
export const MAX_EFFECTIVE_GENRES = 3;
export const MAX_EFFECTIVE_SUBGENRES = 5;
// Last.fm tag weights are relative to the artist's top tag (100). Below this a tag
// is mostly noise, and keeping every official-vocabulary hit would bloat the pool.
export const LASTFM_MIN_WEIGHT = 10;

const NON_AUTO_LEGACY_SOURCES = new Set(['musicbrainz', 'folksonomy']);

export function legacyRows(artist: { genre: string | null; genreSource: string | null }): GenreRow[] {
  // A genre string stamped by MusicBrainz/Last.fm was auto-filled and is
  // superseded by the stored candidates. Anything else (typed by the user, from a
  // media server, or of unknown origin) is preserved: unknown origin is treated
  // as connector-tier so it is kept but never presented as the user's own edit.
  if (!artist.genre || NON_AUTO_LEGACY_SOURCES.has(artist.genreSource ?? '')) return [];
  const source: GenreSource = artist.genreSource === 'user' ? 'user' : artist.genreSource === 'embedded' ? 'embedded' : 'connector';
  const rows: GenreRow[] = [];
  for (const raw of parseGenreList(artist.genre)) {
    const c = classifyGenre(raw);
    if (c) rows.push({ name: c.name, level: c.level, parent: c.parent, source, votes: null, virtual: true });
  }
  return rows;
}

export function selectEffective(rows: GenreRow[]): EffectiveGenre[] {
  if (!rows.length) return [];
  const bestTier = Math.min(...rows.map((r) => TIER[r.source]));
  const tierRows = rows.filter((r) => TIER[r.source] === bestTier);

  const maxVotes = new Map<GenreSource, number>();
  for (const r of tierRows) if (r.votes) maxVotes.set(r.source, Math.max(maxVotes.get(r.source) ?? 0, r.votes));

  const byName = new Map<string, EffectiveGenre>();
  for (const r of tierRows) {
    const max = maxVotes.get(r.source);
    // Votes are only comparable within one source (MusicBrainz counts vs Last.fm
    // 0-100), so each is scaled against that source's own strongest value.
    const relative = r.votes && max ? r.votes / max : 0.5;
    const existing = byName.get(r.name);
    if (!existing) {
      byName.set(r.name, { name: r.name, level: r.level, parent: r.parent, sources: [r.source], score: relative });
    } else {
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
      existing.score = Math.max(existing.score, relative);
    }
  }
  const all = [...byName.values()];
  // Two independent communities agreeing is the strongest signal we have.
  for (const e of all) if (e.sources.length > 1) e.score += 0.25;

  if (bestTier < 2) {
    // Explicit values are never capped or re-ranked; broad genres just lead.
    return all.sort((a, b) => Number(a.level === 'subgenre') - Number(b.level === 'subgenre'));
  }
  const rank = (a: EffectiveGenre, b: EffectiveGenre) =>
    b.sources.length - a.sources.length || b.score - a.score || a.name.localeCompare(b.name);
  const genres = all.filter((e) => e.level === 'genre').sort(rank).slice(0, MAX_EFFECTIVE_GENRES);
  const subs = all.filter((e) => e.level === 'subgenre').sort(rank).slice(0, MAX_EFFECTIVE_SUBGENRES);
  return [...genres, ...subs];
}

function dominantSource(effective: EffectiveGenre[]): GenreSource | null {
  const sources = effective.flatMap((e) => e.sources);
  for (const source of ['user', 'embedded', 'connector', 'musicbrainz', 'lastfm'] as GenreSource[]) {
    if (sources.includes(source)) return source;
  }
  return null;
}

async function loadRows(artist: { id: number; genre: string | null; genreSource: string | null }): Promise<GenreRow[]> {
  const stored = await prisma.artistGenre.findMany({ where: { artistId: artist.id }, orderBy: { id: 'asc' } });
  const rows: GenreRow[] = stored.map((r) => ({
    name: r.name, level: r.level as GenreLevel, parent: r.parent, source: r.source as GenreSource, votes: r.votes,
  }));
  // The legacy string only stands in for explicit-tier data nothing has been
  // stored for yet; once real rows of that tier exist they replace it.
  const hasExplicit = rows.some((r) => TIER[r.source] < 2);
  return hasExplicit ? rows : [...legacyRows(artist), ...rows];
}

// Mirrors the genres in force into Artist.genre — the comma-separated string the
// Library filter, playlist rules and Discover page already read — so none of
// them needed to change. With nothing to mirror it leaves the string alone: an
// empty result usually means a source was unavailable, not that the artist has
// no genre.
export async function syncArtistGenreString(artistId: number): Promise<EffectiveGenre[]> {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  const effective = selectEffective(await loadRows(artist));
  if (!effective.length) return effective;
  const source = dominantSource(effective);
  await prisma.artist.update({
    where: { id: artistId },
    data: {
      genre: effective.map((e) => e.name).join(', '),
      genreSource: source === 'lastfm' ? 'folksonomy' : source,
    },
  });
  return effective;
}

async function replaceSourceRows(artistId: number, source: GenreSource, rows: Array<{ name: string; level: GenreLevel; parent: string | null; votes: number | null }>) {
  await prisma.$transaction([
    prisma.artistGenre.deleteMany({ where: { artistId, source } }),
    prisma.artistGenre.createMany({ data: rows.map((r) => ({ artistId, source, ...r })) }),
  ]);
}

export function genreRowsFromMusicBrainz(artist: { genres: string[]; genreVotes?: Array<{ name: string; votes: number }> }) {
  const votes = artist.genreVotes?.length ? artist.genreVotes : artist.genres.map((name) => ({ name, votes: 0 }));
  const byName = new Map<string, { name: string; level: GenreLevel; parent: string | null; votes: number | null }>();
  for (const v of votes) {
    const c = classifyGenre(v.name);
    if (!c) continue;
    const existing = byName.get(c.name);
    const n = v.votes > 0 ? v.votes : null;
    if (!existing) byName.set(c.name, { name: c.name, level: c.level, parent: c.parent, votes: n });
    else if ((n ?? 0) > (existing.votes ?? 0)) existing.votes = n;
  }
  return [...byName.values()];
}

// Called when an identity is confirmed, with the MusicBrainz lookup that was
// already made — stores that source's candidates without a second request. Last.fm
// is added later by the backfill job (it needs a different provider and is slower
// to fail), so this never touches genresRefreshedAt.
export async function storeMusicBrainzGenres(
  artistId: number,
  metadata: { genres: string[]; genreVotes?: Array<{ name: string; votes: number }> },
): Promise<void> {
  const rows = genreRowsFromMusicBrainz(metadata);
  if (rows.length) await replaceSourceRows(artistId, 'musicbrainz', rows);
  await syncArtistGenreString(artistId);
}

// Last.fm tags are free text; only those that resolve to a MusicBrainz-vocabulary
// genre (after spelling normalisation, so "hip-hop" and "rap" count) become
// candidates. Decades, nationalities and "female vocalists" are dropped here.
export function genreRowsFromLastFmTags(tags: Array<{ name: string; count: number }>) {
  const byName = new Map<string, { name: string; level: GenreLevel; parent: string | null; votes: number | null }>();
  for (const tag of tags) {
    if (tag.count < LASTFM_MIN_WEIGHT) continue;
    const c = classifyGenre(tag.name);
    if (!c || !c.official) continue;
    const existing = byName.get(c.name);
    if (!existing) byName.set(c.name, { name: c.name, level: c.level, parent: c.parent, votes: tag.count });
    else if (tag.count > (existing.votes ?? 0)) existing.votes = tag.count;
  }
  return [...byName.values()];
}

export type SourceOutcome = 'updated' | 'unchanged-empty' | 'not-configured' | 'skipped' | 'failed';
export interface GenreRefreshResult { musicbrainz: SourceOutcome; lastfm: SourceOutcome }

export async function refreshArtistGenres(
  artistId: number,
  options: { musicbrainz?: boolean; lastfm?: boolean } = {},
): Promise<GenreRefreshResult> {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  const result: GenreRefreshResult = { musicbrainz: 'skipped', lastfm: 'skipped' };

  if (options.musicbrainz !== false) {
    if (!artist.musicbrainzArtistId) {
      result.musicbrainz = 'not-configured';
    } else {
      try {
        const rows = genreRowsFromMusicBrainz(await lookupMusicBrainzArtist(artist.musicbrainzArtistId));
        if (rows.length) { await replaceSourceRows(artistId, 'musicbrainz', rows); result.musicbrainz = 'updated'; }
        else result.musicbrainz = 'unchanged-empty';
      } catch (err) {
        result.musicbrainz = 'failed';
        await logActivity('warn', 'artist-genres:musicbrainz', err);
      }
    }
  }

  if (options.lastfm !== false) {
    const lastfm = (await getEnabledProviders()).find((p) => p.name === 'lastfm' && p.provider.getArtistTags);
    if (!lastfm) {
      result.lastfm = 'not-configured';
    } else {
      try {
        const tags = await lastfm.provider.getArtistTags!({ name: artist.name, mbid: artist.musicbrainzArtistId });
        const rows = genreRowsFromLastFmTags(tags);
        // Last.fm answers 200-with-no-tags for artists it does not know, which is
        // indistinguishable from a transient miss — never wipe stored rows on it.
        if (rows.length) { await replaceSourceRows(artistId, 'lastfm', rows); result.lastfm = 'updated'; }
        else result.lastfm = 'unchanged-empty';
      } catch (err) {
        result.lastfm = 'failed';
        await logActivity('warn', 'artist-genres:lastfm', err);
      }
    }
  }

  const reachedASource = result.musicbrainz === 'updated' || result.musicbrainz === 'unchanged-empty'
    || result.lastfm === 'updated' || result.lastfm === 'unchanged-empty';
  if (reachedASource) await prisma.artist.update({ where: { id: artistId }, data: { genresRefreshedAt: new Date() } });
  await syncArtistGenreString(artistId);
  return result;
}

// Replaces the user's explicit genres. An empty list means "go back to
// automatic": the user rows are dropped, and so is a typed legacy string, which
// would otherwise keep standing in as an explicit value.
export async function setUserGenres(artistId: number, names: string[]): Promise<void> {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  const rows = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const c = classifyGenre(raw);
    if (!c || seen.has(c.name)) continue;
    seen.add(c.name);
    rows.push({ name: c.name, level: c.level, parent: c.parent, votes: null });
  }
  await replaceSourceRows(artistId, 'user', rows);
  if (!rows.length && legacyRows(artist).length) {
    await prisma.artist.update({ where: { id: artistId }, data: { genre: null, genreSource: null } });
  }
  await syncArtistGenreString(artistId);
}

// ---- Library-wide counts -------------------------------------------------

export interface GenreStatsSubgenre { name: string; parent: string; artistCount: number; percentOfArtists: number; percentOfParent: number }
export interface GenreStatsGenre {
  name: string;
  isOther: boolean;
  // Artists in this genre including those who only have one of its sub-genres.
  artistCount: number;
  percentOfArtists: number;
  percentOfGenred: number;
  // Artists tagged with the broad genre itself.
  directArtistCount: number;
  subgenres: GenreStatsSubgenre[];
}
export interface GenreStats {
  totalArtists: number;
  artistsWithGenre: number;
  genres: GenreStatsGenre[];
  consolidation: {
    smallThreshold: number;
    variantGroups: Array<{ names: string[]; artistsAffected: number }>;
    smallSubgenres: Array<{ parent: string; subgenres: string[]; subgenreCount: number; artistsAffected: number }>;
  };
}

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const OTHER = 'other';

export function buildGenreStats(perArtist: Map<number, EffectiveGenre[]>, smallThreshold = 1): GenreStats {
  const totalArtists = perArtist.size;
  const withGenre = [...perArtist.values()].filter((g) => g.length);
  const artistsWithGenre = withGenre.length;

  const direct = new Map<string, Set<number>>();       // broad genre -> artists tagged with it directly
  const rolled = new Map<string, Set<number>>();       // broad genre (or other) -> artists incl. via sub-genres
  const sub = new Map<string, { parent: string; artists: Set<number> }>();
  const allNames = new Map<string, Set<number>>();
  const add = (map: Map<string, Set<number>>, key: string, id: number) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
  };

  for (const [artistId, effective] of perArtist) {
    for (const g of effective) {
      add(allNames, g.name, artistId);
      if (g.level === 'genre') {
        add(direct, g.name, artistId);
        add(rolled, g.name, artistId);
      } else {
        const parent = g.parent ?? OTHER;
        add(rolled, parent, artistId);
        if (!sub.has(g.name)) sub.set(g.name, { parent, artists: new Set() });
        sub.get(g.name)!.artists.add(artistId);
      }
    }
  }

  const genres: GenreStatsGenre[] = [...rolled.entries()].map(([name, artists]) => {
    const subgenres = [...sub.entries()]
      .filter(([, v]) => v.parent === name)
      .map(([subName, v]) => ({
        name: subName,
        parent: name,
        artistCount: v.artists.size,
        percentOfArtists: pct(v.artists.size, totalArtists),
        percentOfParent: pct(v.artists.size, artists.size),
      }))
      .sort((a, b) => b.artistCount - a.artistCount || a.name.localeCompare(b.name));
    return {
      name,
      isOther: name === OTHER,
      artistCount: artists.size,
      percentOfArtists: pct(artists.size, totalArtists),
      percentOfGenred: pct(artists.size, artistsWithGenre),
      directArtistCount: direct.get(name)?.size ?? 0,
      subgenres,
    };
  }).sort((a, b) => Number(a.isOther) - Number(b.isOther) || b.artistCount - a.artistCount || a.name.localeCompare(b.name));

  // Names that differ only by spacing/punctuation are the same genre written two
  // ways — the clearest consolidation candidates.
  const byKey = new Map<string, string[]>();
  for (const name of allNames.keys()) {
    const key = name.replace(/[^a-z0-9]/g, '');
    byKey.set(key, [...(byKey.get(key) ?? []), name]);
  }
  const variantGroups = [...byKey.values()].filter((names) => names.length > 1).map((names) => ({
    names: names.sort(),
    artistsAffected: new Set(names.flatMap((n) => [...allNames.get(n)!])).size,
  }));

  const smallByParent = new Map<string, Array<{ name: string; artists: Set<number> }>>();
  for (const [name, v] of sub) {
    if (v.artists.size > smallThreshold) continue;
    smallByParent.set(v.parent, [...(smallByParent.get(v.parent) ?? []), { name, artists: v.artists }]);
  }
  const smallSubgenres = [...smallByParent.entries()].map(([parent, items]) => ({
    parent,
    subgenres: items.map((i) => i.name).sort().slice(0, 25),
    subgenreCount: items.length,
    artistsAffected: new Set(items.flatMap((i) => [...i.artists])).size,
  })).sort((a, b) => b.subgenreCount - a.subgenreCount || a.parent.localeCompare(b.parent));

  return { totalArtists, artistsWithGenre, genres, consolidation: { smallThreshold, variantGroups, smallSubgenres } };
}

// Library artists are the MusicBrainz-confirmed ones (the same set the Library
// page lists), so percentages read as "of the artists you see in Library".
export async function loadLibraryEffective(): Promise<Map<number, EffectiveGenre[]>> {
  const artists = await prisma.artist.findMany({
    where: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null } },
    select: { id: true, genre: true, genreSource: true },
  });
  const stored = await prisma.artistGenre.findMany({
    where: { artist: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null } } },
    orderBy: { id: 'asc' },
  });
  const byArtist = new Map<number, GenreRow[]>();
  for (const r of stored) {
    const list = byArtist.get(r.artistId) ?? [];
    list.push({ name: r.name, level: r.level as GenreLevel, parent: r.parent, source: r.source as GenreSource, votes: r.votes });
    byArtist.set(r.artistId, list);
  }
  const out = new Map<number, EffectiveGenre[]>();
  for (const a of artists) {
    const rows = byArtist.get(a.id) ?? [];
    const merged = rows.some((r) => TIER[r.source] < 2) ? rows : [...legacyRows(a), ...rows];
    out.set(a.id, selectEffective(merged));
  }
  return out;
}

export async function getGenreStats(smallThreshold = 1): Promise<GenreStats> {
  return buildGenreStats(await loadLibraryEffective(), smallThreshold);
}

// ---- Per-artist editor view ----------------------------------------------

export interface GenreView {
  artistId: number;
  genreString: string | null;
  userOverride: boolean;
  refreshedAt: string | null;
  totalArtists: number;
  effective: Array<EffectiveGenre & { artistCount: number; percentOfArtists: number }>;
  sources: Record<'user' | 'connector' | 'embedded' | 'musicbrainz' | 'lastfm', Array<{ name: string; level: GenreLevel; parent: string | null; votes: number | null; inEffect: boolean }>>;
  alternatives: Array<{ name: string; level: GenreLevel; parent: string | null; reason: string; artistCount: number; percentOfArtists: number }>;
}

export async function getArtistGenreView(artistId: number): Promise<GenreView> {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  const rows = await loadRows(artist);
  const effective = selectEffective(rows);
  const effectiveNames = new Set(effective.map((e) => e.name));

  const library = await loadLibraryEffective();
  const totalArtists = library.size;
  const counts = new Map<string, number>();
  for (const genres of library.values()) for (const g of genres) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
  const withCounts = <T extends { name: string }>(item: T) => ({
    ...item, artistCount: counts.get(item.name) ?? 0, percentOfArtists: pct(counts.get(item.name) ?? 0, totalArtists),
  });

  const sources: GenreView['sources'] = { user: [], connector: [], embedded: [], musicbrainz: [], lastfm: [] };
  for (const r of rows) {
    sources[r.source].push({ name: r.name, level: r.level, parent: r.parent, votes: r.votes, inEffect: effectiveNames.has(r.name) });
  }
  for (const list of Object.values(sources)) list.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.name.localeCompare(b.name));

  // Alternatives, most specific evidence first: candidates other sources offered
  // that are not in force, then the broad genre a chosen sub-genre rolls up into,
  // then genres already established in the library under the same broad genre
  // (so a user can pick an existing label rather than coin a near-duplicate).
  const alternatives: GenreView['alternatives'] = [];
  const offered = new Set<string>(effectiveNames);
  const offer = (name: string, level: GenreLevel, parent: string | null, reason: string) => {
    if (offered.has(name)) return;
    offered.add(name);
    alternatives.push(withCounts({ name, level, parent, reason }));
  };
  const candidates = rows.filter((r) => !effectiveNames.has(r.name))
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
  const label: Record<GenreSource, string> = { user: 'your edit', connector: 'your media server', embedded: 'file tags', musicbrainz: 'MusicBrainz', lastfm: 'Last.fm' };
  for (const r of candidates) {
    offer(r.name, r.level, r.parent, r.votes ? `${label[r.source]} (${r.votes}${r.source === 'musicbrainz' ? ' votes' : '/100'})` : `From ${label[r.source]}`);
  }
  for (const e of effective) {
    if (e.level === 'subgenre' && e.parent && BROAD_GENRES.includes(e.parent)) {
      offer(e.parent, 'genre', null, `Broad genre for ${e.name}`);
    }
  }
  const families = new Set(effective.map((e) => e.parent ?? e.name));
  const siblings = new Map<string, { level: GenreLevel; parent: string | null }>();
  for (const genres of library.values()) {
    for (const g of genres) {
      if (families.has(g.parent ?? g.name)) siblings.set(g.name, { level: g.level, parent: g.parent });
    }
  }
  [...siblings.entries()]
    .sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0) || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .forEach(([name, v]) => offer(name, v.level, v.parent, 'Already used in your library'));

  return {
    artistId,
    genreString: artist.genre,
    userOverride: rows.some((r) => r.source === 'user'),
    refreshedAt: artist.genresRefreshedAt?.toISOString() ?? null,
    totalArtists,
    effective: effective.map(withCounts),
    sources,
    alternatives: alternatives.slice(0, 14),
  };
}

// Fills in genre candidates for confirmed artists that have never been refreshed.
// Small batches: each artist costs a rate-limited MusicBrainz request, and the
// scheduler re-invokes this straight away while work remains.
export async function backfillArtistGenres(batchSize = 10): Promise<{ checked: number; refreshed: number; remaining: number }> {
  const where = { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null }, genresRefreshedAt: null } as const;
  const retryBefore = new Date(Date.now() - 10 * 60_000);
  const artists = await prisma.artist.findMany({
    where: { ...where, OR: [{ genresRefreshAttemptedAt: null }, { genresRefreshAttemptedAt: { lte: retryBefore } }] },
    select: { id: true }, orderBy: [{ genresRefreshAttemptedAt: 'asc' }, { id: 'asc' }], take: batchSize,
  });
  let refreshed = 0;
  for (const artist of artists) {
    try {
      // Record attempts independently of successful refreshes so a permanently
      // failing identity cannot keep every later artist out of the next batch.
      await prisma.artist.update({ where: { id: artist.id }, data: { genresRefreshAttemptedAt: new Date() } });
      await refreshArtistGenres(artist.id);
      const after = await prisma.artist.findUnique({ where: { id: artist.id }, select: { genresRefreshedAt: true } });
      if (after?.genresRefreshedAt) refreshed++;
    } catch (err) {
      await logActivity('warn', 'artist-genres:backfill', err);
    }
  }
  return { checked: artists.length, refreshed, remaining: await prisma.artist.count({ where }) };
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist } from './support/db.js';

const musicBrainz = vi.hoisted(() => ({ lookup: vi.fn() }));
const providers = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock('../src/providers/metadata/musicbrainz.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/metadata/musicbrainz.js')>()),
  lookupMusicBrainzArtist: musicBrainz.lookup,
}));
vi.mock('../src/pipeline/recommendations.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/pipeline/recommendations.js')>()),
  getEnabledProviders: providers.enabled,
}));

import {
  buildGenreStats,
  genreRowsFromLastFmTags,
  genreRowsFromMusicBrainz,
  getArtistGenreView,
  getGenreStats,
  legacyRows,
  refreshArtistGenres,
  selectEffective,
  setUserGenres,
  backfillArtistGenres,
  type EffectiveGenre,
  type GenreRow,
} from '../src/pipeline/artistGenres.js';

const row = (name: string, source: GenreRow['source'], votes: number | null, level: GenreRow['level'] = 'subgenre', parent: string | null = null): GenreRow =>
  ({ name, source, votes, level, parent });
const eff = (name: string, level: 'genre' | 'subgenre', parent: string | null = null): EffectiveGenre =>
  ({ name, level, parent, sources: ['musicbrainz'], score: 1 });

describe('selectEffective', () => {
  it('uses the user\'s genres alone, uncapped, when any exist', () => {
    const rows = [
      row('rock', 'user', null, 'genre'),
      row('shoegaze', 'user', null, 'subgenre', 'rock'),
      row('pop', 'musicbrainz', 99, 'genre'),
      row('jazz', 'lastfm', 80, 'genre'),
    ];
    expect(selectEffective(rows).map((e) => e.name)).toEqual(['rock', 'shoegaze']);
  });

  it('prefers connector/embedded values over community sources', () => {
    const rows = [row('rock', 'connector', null, 'genre'), row('pop', 'musicbrainz', 50, 'genre')];
    expect(selectEffective(rows).map((e) => e.name)).toEqual(['rock']);
  });

  it('merges MusicBrainz and Last.fm as peers and ranks agreement first', () => {
    const rows = [
      row('art rock', 'musicbrainz', 20), row('shoegaze', 'musicbrainz', 5),
      row('shoegaze', 'lastfm', 90), row('dream pop', 'lastfm', 100),
    ];
    const out = selectEffective(rows);
    expect(out[0].name).toBe('shoegaze');
    expect(out[0].sources.sort()).toEqual(['lastfm', 'musicbrainz']);
    expect(out.map((e) => e.name)).toEqual(expect.arrayContaining(['art rock', 'dream pop']));
  });

  it('keeps weaker community agreement ahead of strong single-source genres at the cap', () => {
    const rows = [
      row('rock', 'musicbrainz', 1, 'genre'), row('rock', 'lastfm', 10, 'genre'),
      row('pop', 'musicbrainz', 10, 'genre'), row('jazz', 'lastfm', 100, 'genre'),
      row('blues', 'lastfm', 90, 'genre'),
    ];
    const selected = selectEffective(rows);
    expect(selected[0].name).toBe('rock');
    expect(selected).toHaveLength(3);
  });

  it('scales votes within each source so counts and 0-100 weights are comparable', () => {
    // 4 of MusicBrainz's max 4 should outrank Last.fm's 40 of its max 100.
    const out = selectEffective([row('a', 'musicbrainz', 4), row('b', 'musicbrainz', 1), row('c', 'lastfm', 100), row('d', 'lastfm', 40)]);
    expect(out.findIndex((e) => e.name === 'a')).toBeLessThan(out.findIndex((e) => e.name === 'd'));
  });

  it('caps community results at 3 genres and 5 sub-genres', () => {
    const rows = [
      ...['rock', 'pop', 'jazz', 'blues', 'folk'].map((n, i) => row(n, 'musicbrainz', 100 - i, 'genre')),
      ...Array.from({ length: 9 }, (_, i) => row(`sub ${i}`, 'musicbrainz', 50 - i)),
    ];
    const out = selectEffective(rows);
    expect(out.filter((e) => e.level === 'genre')).toHaveLength(3);
    expect(out.filter((e) => e.level === 'subgenre')).toHaveLength(5);
  });

  it('returns nothing for no rows', () => {
    expect(selectEffective([])).toEqual([]);
  });
});

describe('legacyRows', () => {
  it('keeps typed / media-server / unknown-origin strings', () => {
    expect(legacyRows({ genre: 'Rock, Synthpop', genreSource: 'user' }).map((r) => [r.name, r.source]))
      .toEqual([['rock', 'user'], ['synth-pop', 'user']]);
    expect(legacyRows({ genre: 'Jazz', genreSource: null })[0].source).toBe('connector');
  });

  it('ignores strings that MusicBrainz or Last.fm auto-filled', () => {
    expect(legacyRows({ genre: 'rock', genreSource: 'musicbrainz' })).toEqual([]);
    expect(legacyRows({ genre: 'rock', genreSource: 'folksonomy' })).toEqual([]);
    expect(legacyRows({ genre: null, genreSource: null })).toEqual([]);
  });
});

describe('source row builders', () => {
  it('keeps every MusicBrainz genre with its votes, strongest first', () => {
    const rows = genreRowsFromMusicBrainz({ genres: ['pop', 'synth-pop'], genreVotes: [{ name: 'synth-pop', votes: 7 }, { name: 'pop', votes: 3 }] });
    expect(rows).toEqual([
      { name: 'synth-pop', level: 'subgenre', parent: 'pop', votes: 7 },
      { name: 'pop', level: 'genre', parent: null, votes: 3 },
    ]);
  });

  it('works from names alone when no votes are available', () => {
    expect(genreRowsFromMusicBrainz({ genres: ['synth-pop'] })).toEqual([{ name: 'synth-pop', level: 'subgenre', parent: 'pop', votes: null }]);
  });

  it('turns only vocabulary genres of meaningful weight from Last.fm tags into candidates', () => {
    const rows = genreRowsFromLastFmTags([
      { name: 'alternative rock', count: 100 }, { name: 'female vocalists', count: 90 }, { name: '90s', count: 60 },
      { name: 'Radiohead', count: 55 }, { name: 'hip-hop', count: 40 }, { name: 'rap', count: 30 }, { name: 'shoegaze', count: 4 },
    ]);
    expect(rows.map((r) => r.name).sort()).toEqual(['alternative rock', 'hip hop']);
    expect(rows.find((r) => r.name === 'hip hop')?.votes).toBe(40);
  });
});

describe('buildGenreStats', () => {
  const library = new Map<number, EffectiveGenre[]>([
    [1, [eff('rock', 'genre'), eff('shoegaze', 'subgenre', 'rock')]],
    [2, [eff('shoegaze', 'subgenre', 'rock')]],
    [3, [eff('synth-pop', 'subgenre', 'pop'), eff('synthpop', 'subgenre', 'pop')]],
    [4, [eff('xyzzy sound', 'subgenre', null)]],
    [5, []],
  ]);

  it('counts artists per genre including those reached only through a sub-genre', () => {
    const stats = buildGenreStats(library);
    expect(stats.totalArtists).toBe(5);
    expect(stats.artistsWithGenre).toBe(4);
    const rock = stats.genres.find((g) => g.name === 'rock')!;
    expect(rock.artistCount).toBe(2);            // artist 1 directly, artist 2 via shoegaze
    expect(rock.directArtistCount).toBe(1);
    expect(rock.percentOfArtists).toBe(40);       // 2 of 5 library artists
    expect(rock.percentOfGenred).toBe(50);        // 2 of 4 artists that have any genre
    expect(rock.subgenres).toEqual([{ name: 'shoegaze', parent: 'rock', artistCount: 2, percentOfArtists: 40, percentOfParent: 100 }]);
  });

  it('puts sub-genres with no inferable parent under a trailing "other" bucket', () => {
    const stats = buildGenreStats(library);
    const last = stats.genres[stats.genres.length - 1];
    expect(last).toMatchObject({ name: 'other', isOther: true, artistCount: 1 });
    expect(last.subgenres[0].name).toBe('xyzzy sound');
  });

  it('flags spellings that differ only by punctuation as consolidation candidates', () => {
    const stats = buildGenreStats(library);
    expect(stats.consolidation.variantGroups).toEqual([{ names: ['synth-pop', 'synthpop'], artistsAffected: 1 }]);
  });

  it('groups small sub-genres under their parent, honouring the threshold', () => {
    const one = buildGenreStats(library, 1).consolidation.smallSubgenres;
    expect(one.find((s) => s.parent === 'rock')).toBeUndefined(); // shoegaze has 2 artists
    expect(one.find((s) => s.parent === 'pop')).toMatchObject({ subgenreCount: 2, artistsAffected: 1 });
    const two = buildGenreStats(library, 2).consolidation.smallSubgenres;
    expect(two.find((s) => s.parent === 'rock')).toMatchObject({ subgenres: ['shoegaze'], artistsAffected: 2 });
  });

  it('handles an empty library without dividing by zero', () => {
    const stats = buildGenreStats(new Map());
    expect(stats).toMatchObject({ totalArtists: 0, artistsWithGenre: 0, genres: [] });
  });
});

describe('artist genre refresh and editing (database)', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  async function confirmed(name: string, overrides: Parameters<typeof createArtist>[2] = {}) {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name, ...overrides });
    return prisma.artist.update({
      where: { id: artist.id },
      data: { musicbrainzArtistId: `00000000-0000-4000-8000-${artist.id.toString(16).padStart(12, '0')}`, musicbrainzMatchStatus: 'confirmed' },
    });
  }
  const lastfm = (tags: Array<{ name: string; count: number }> | Error) => ({
    name: 'lastfm',
    provider: { getSimilarArtists: async () => [], getArtistTags: async () => { if (tags instanceof Error) throw tags; return tags; } },
  });
  const mbReturns = (genreVotes: Array<{ name: string; votes: number }>) =>
    musicBrainz.lookup.mockResolvedValue({ genres: genreVotes.map((g) => g.name), genreVotes });

  beforeEach(async () => {
    await resetDb();
    musicBrainz.lookup.mockReset();
    providers.enabled.mockReset().mockResolvedValue([]);
    rootFolderId = (await createRootFolder()).id;
    qualityProfileId = (await createQualityProfile((await createQuality()).id)).id;
  });

  it('keeps MusicBrainz and Last.fm candidates side by side and mirrors the merge into Artist.genre', async () => {
    const artist = await confirmed('Both Sources');
    mbReturns([{ name: 'shoegaze', votes: 9 }, { name: 'rock', votes: 4 }]);
    providers.enabled.mockResolvedValue([lastfm([{ name: 'shoegaze', count: 100 }, { name: 'dream pop', count: 70 }, { name: 'seen live', count: 50 }])]);

    const result = await refreshArtistGenres(artist.id);
    expect(result).toEqual({ musicbrainz: 'updated', lastfm: 'updated' });

    const stored = await prisma.artistGenre.findMany({ where: { artistId: artist.id } });
    expect(stored.filter((r) => r.source === 'musicbrainz').map((r) => r.name).sort()).toEqual(['rock', 'shoegaze']);
    expect(stored.filter((r) => r.source === 'lastfm').map((r) => r.name).sort()).toEqual(['dream pop', 'shoegaze']);
    const after = await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } });
    expect(after.genre?.split(', ')).toEqual(expect.arrayContaining(['rock', 'shoegaze', 'dream pop']));
    expect(after.genresRefreshedAt).not.toBeNull();
  });

  it('never replaces the user\'s genres on refresh, though candidates update', async () => {
    const artist = await confirmed('Edited');
    await setUserGenres(artist.id, ['Trip Hop']);
    mbReturns([{ name: 'pop', votes: 5 }]);
    await refreshArtistGenres(artist.id);

    const after = await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } });
    expect(after.genre).toBe('trip hop');
    expect(after.genreSource).toBe('user');
    expect((await getArtistGenreView(artist.id)).sources.musicbrainz.map((g) => g.name)).toEqual(['pop']);
  });

  it('keeps stored candidates when a source fails or answers with nothing usable', async () => {
    const artist = await confirmed('Flaky');
    mbReturns([{ name: 'jazz', votes: 3 }]);
    providers.enabled.mockResolvedValue([lastfm([{ name: 'bebop', count: 80 }])]);
    await refreshArtistGenres(artist.id);

    musicBrainz.lookup.mockRejectedValue(new Error('MusicBrainz down'));
    providers.enabled.mockResolvedValue([lastfm([{ name: 'seen live', count: 90 }])]); // no genre in it
    const result = await refreshArtistGenres(artist.id);
    expect(result).toEqual({ musicbrainz: 'failed', lastfm: 'unchanged-empty' });
    const names = (await prisma.artistGenre.findMany({ where: { artistId: artist.id } })).map((r) => r.name).sort();
    expect(names).toEqual(['bebop', 'jazz']);

    providers.enabled.mockResolvedValue([lastfm(new Error('timeout'))]);
    expect((await refreshArtistGenres(artist.id)).lastfm).toBe('failed');
    expect(await prisma.artistGenre.count({ where: { artistId: artist.id, source: 'lastfm' } })).toBe(1);
  });

  it('does not mark an artist refreshed when no source could be reached', async () => {
    const artist = await confirmed('Offline');
    musicBrainz.lookup.mockRejectedValue(new Error('down'));
    await refreshArtistGenres(artist.id);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).genresRefreshedAt).toBeNull();
  });

  it('processes later artists while failed lookups cool down and retries failures later', async () => {
    const failed = await confirmed('Failed');
    const healthy = await confirmed('Healthy');
    const lookup = async (id: string) => {
      if (id.endsWith(failed.id.toString(16).padStart(12, '0'))) throw new Error('permanent 404');
      return { genres: ['rock'] };
    };
    musicBrainz.lookup.mockImplementation(lookup);
    expect(await backfillArtistGenres(1)).toMatchObject({ checked: 1, refreshed: 0, remaining: 2 });
    expect(await backfillArtistGenres(1)).toMatchObject({ checked: 1, refreshed: 1, remaining: 1 });
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: healthy.id } })).genre).toBe('rock');
    expect(await backfillArtistGenres(1)).toMatchObject({ checked: 0, remaining: 1 });
    const failedRow = await prisma.artist.findUniqueOrThrow({ where: { id: failed.id } });
    expect(failedRow.genresRefreshedAt).toBeNull();
    expect(failedRow.genresRefreshAttemptedAt).not.toBeNull();
    await prisma.artist.update({ where: { id: failed.id }, data: { genresRefreshAttemptedAt: new Date(Date.now() - 11 * 60_000) } });
    mbReturns([{ name: 'jazz', votes: 5 }]);
    expect(await backfillArtistGenres(1)).toMatchObject({ checked: 1, refreshed: 1, remaining: 0 });
  });

  it('preserves a genre typed before this feature and does not let a refresh overwrite it', async () => {
    const artist = await confirmed('Legacy', { genre: 'Shoegaze' });
    await prisma.artist.update({ where: { id: artist.id }, data: { genreSource: 'user' } });
    mbReturns([{ name: 'pop', votes: 5 }]);
    await refreshArtistGenres(artist.id);

    const view = await getArtistGenreView(artist.id);
    expect(view.effective.map((e) => e.name)).toEqual(['shoegaze']);
    expect(view.userOverride).toBe(true);
    expect(view.alternatives.map((a) => a.name)).toContain('pop');
  });

  it('lets an auto-filled MusicBrainz string be superseded by the richer stored candidates', async () => {
    const artist = await confirmed('Auto', { genre: 'rock' });
    await prisma.artist.update({ where: { id: artist.id }, data: { genreSource: 'musicbrainz' } });
    mbReturns([{ name: 'rock', votes: 9 }, { name: 'art rock', votes: 8 }]);
    await refreshArtistGenres(artist.id);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).genre).toBe('rock, art rock');
  });

  it('reverts to automatic when the user clears their genres, including a typed legacy value', async () => {
    const artist = await confirmed('Reset', { genre: 'Polka' });
    await prisma.artist.update({ where: { id: artist.id }, data: { genreSource: 'user' } });
    mbReturns([{ name: 'folk', votes: 5 }]);
    await refreshArtistGenres(artist.id);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).genre).toBe('polka');

    await setUserGenres(artist.id, []);
    const after = await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } });
    expect(after.genre).toBe('folk');
    expect(after.genreSource).toBe('musicbrainz');
    expect((await getArtistGenreView(artist.id)).userOverride).toBe(false);
  });

  it('records the library count and percentage for each genre in force and each alternative', async () => {
    const a = await confirmed('Subject');
    const b = await confirmed('Peer One');
    const c = await confirmed('Peer Two');
    await confirmed('Unrelated');
    await setUserGenres(b.id, ['shoegaze', 'rock']);
    await setUserGenres(c.id, ['shoegaze', 'dream pop']);
    await setUserGenres(a.id, ['shoegaze']);

    const view = await getArtistGenreView(a.id);
    expect(view.totalArtists).toBe(4);
    expect(view.effective[0]).toMatchObject({ name: 'shoegaze', artistCount: 3, percentOfArtists: 75 });
    const rock = view.alternatives.find((x) => x.name === 'rock')!;
    expect(rock).toMatchObject({ artistCount: 1, percentOfArtists: 25 });
    expect(rock.reason).toBe('Broad genre for shoegaze');
    expect(view.alternatives.map((x) => x.name)).not.toContain('shoegaze'); // already in force
  });

  it('counts only MusicBrainz-confirmed artists in library statistics', async () => {
    const shown = await confirmed('Shown');
    const hidden = await createArtist(rootFolderId, qualityProfileId, { name: 'Unmatched' });
    await setUserGenres(shown.id, ['rock']);
    await setUserGenres(hidden.id, ['rock']);
    const stats = await getGenreStats();
    expect(stats.totalArtists).toBe(1);
    expect(stats.genres.find((g) => g.name === 'rock')).toMatchObject({ artistCount: 1, percentOfArtists: 100 });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createArtist } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

// No test may reach the real MusicBrainz: refresh routes look the artist up there.
vi.mock('../../src/providers/metadata/musicbrainz.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/providers/metadata/musicbrainz.js')>()),
  lookupMusicBrainzArtist: vi.fn().mockRejectedValue(new Error('offline')),
}));

describe('genre routes', () => {
  let app: FastifyInstance;
  let rootFolderId: number;
  let qualityProfileId: number;

  async function confirmed(name: string, genre: string | null = null) {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name, genre });
    return prisma.artist.update({
      where: { id: artist.id },
      data: { musicbrainzArtistId: `00000000-0000-4000-8000-${artist.id.toString(16).padStart(12, '0')}`, musicbrainzMatchStatus: 'confirmed' },
    });
  }

  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    rootFolderId = (await createRootFolder()).id;
    qualityProfileId = (await createQualityProfile((await createQuality()).id)).id;
  });

  it('requires authentication', async () => {
    const artist = await confirmed('Secured');
    expect((await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/genres` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/genres/stats' })).statusCode).toBe(401);
  });

  it('404s for an unknown artist on every artist genre route', async () => {
    for (const [method, url] of [['GET', '/api/v1/artist/999/genres'], ['PUT', '/api/v1/artist/999/genres'], ['POST', '/api/v1/artist/999/genres/refresh']] as const) {
      const res = await app.inject({ method, url, headers: authHeaders(), payload: method === 'PUT' ? { genres: ['rock'] } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('PUT stores the user\'s genres, splitting them into genres and sub-genres, and mirrors Artist.genre', async () => {
    const artist = await confirmed('Editable');
    const res = await app.inject({
      method: 'PUT', url: `/api/v1/artist/${artist.id}/genres`, headers: authHeaders(),
      payload: { genres: ['Rock', 'Shoegaze', 'rock'] },
    });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.userOverride).toBe(true);
    expect(view.effective.map((e: { name: string; level: string }) => [e.name, e.level])).toEqual([['rock', 'genre'], ['shoegaze', 'subgenre']]);
    expect(view.genreString).toBe('rock, shoegaze');
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).genreSource).toBe('user');
  });

  it('PUT with an empty list returns control to automatic', async () => {
    const artist = await confirmed('Clearable');
    await app.inject({ method: 'PUT', url: `/api/v1/artist/${artist.id}/genres`, headers: authHeaders(), payload: { genres: ['jazz'] } });
    const res = await app.inject({ method: 'PUT', url: `/api/v1/artist/${artist.id}/genres`, headers: authHeaders(), payload: { genres: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().userOverride).toBe(false);
  });

  it('rejects malformed bodies', async () => {
    const artist = await confirmed('Strict');
    for (const payload of [{}, { genres: 'rock' }, { genres: [''] }, { genres: Array.from({ length: 31 }, (_, i) => `g${i}`) }]) {
      const res = await app.inject({ method: 'PUT', url: `/api/v1/artist/${artist.id}/genres`, headers: authHeaders(), payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('the older PUT /artist/:id genre field becomes the user\'s explicit genres too', async () => {
    const artist = await confirmed('Legacy Field');
    const res = await app.inject({ method: 'PUT', url: `/api/v1/artist/${artist.id}`, headers: authHeaders(), payload: { genre: 'Synthpop, Rock' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().genre).toBe('rock, synth-pop');
    const view = (await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}/genres`, headers: authHeaders() })).json();
    expect(view.userOverride).toBe(true);
  });

  it('GET /genres/stats reports counts and percentages of library artists per genre and sub-genre', async () => {
    const a = await confirmed('A'); const b = await confirmed('B'); await confirmed('C'); await confirmed('D');
    for (const [artist, genres] of [[a, ['rock', 'shoegaze']], [b, ['shoegaze']]] as const) {
      await app.inject({ method: 'PUT', url: `/api/v1/artist/${artist.id}/genres`, headers: authHeaders(), payload: { genres } });
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/genres/stats', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats).toMatchObject({ totalArtists: 4, artistsWithGenre: 2 });
    const rock = stats.genres.find((g: { name: string }) => g.name === 'rock');
    expect(rock).toMatchObject({ artistCount: 2, percentOfArtists: 50, percentOfGenred: 100, directArtistCount: 1 });
    expect(rock.subgenres).toEqual([{ name: 'shoegaze', parent: 'rock', artistCount: 2, percentOfArtists: 50, percentOfParent: 100 }]);
  });

  it('GET /genres/stats validates its threshold', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/genres/stats?smallThreshold=0', headers: authHeaders() })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/genres/stats?smallThreshold=3', headers: authHeaders() })).json().consolidation.smallThreshold).toBe(3);
  });

  it('POST refresh with no providers reports not-configured and leaves existing genres alone', async () => {
    const artist = await confirmed('Quiet', 'Rock');
    await prisma.artist.update({ where: { id: artist.id }, data: { genreSource: 'user' } });
    // MusicBrainz is mocked as unreachable above, so only the explicit genre remains.
    const res = await app.inject({ method: 'POST', url: `/api/v1/artist/${artist.id}/genres/refresh`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ musicbrainz: 'failed', lastfm: 'not-configured' });
    expect(res.json().view.effective.map((e: { name: string }) => e.name)).toEqual(['rock']);
  });
});

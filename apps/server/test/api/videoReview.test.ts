import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createArtist } from '../support/db.js';

describe('artist and video review boundaries', () => {
  let app: FastifyInstance;
  let artistId: number;

  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    artistId = (await createArtist(root.id, profile.id, { name: 'AC/DC' })).id;
  });

  it('keeps an unmatched observed artist in Match Review and out of Library', async () => {
    const library = await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() });
    const review = await app.inject({ method: 'GET', url: '/api/v1/artist/match-review', headers: authHeaders() });
    expect(library.json().items).toHaveLength(0);
    expect(review.json()).toEqual([expect.objectContaining({ id: artistId, name: 'AC/DC' })]);
  });

  it('moves a confirmed artist into Library and only adds an approved song video', async () => {
    await prisma.artist.update({ where: { id: artistId }, data: {
      musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    } });
    const candidate = await prisma.videoReviewCandidate.create({ data: {
      source: 'youtube', externalId: 'song-id', artistId, artistName: 'AC/DC', title: 'Thunderstruck',
      url: 'https://www.youtube.com/watch?v=song-id', reason: 'Needs review',
      sourcePublishedAt: new Date('1990-01-01T00:00:00Z'),
    } });
    const result = await app.inject({ method: 'POST', url: `/api/v1/video-review/${candidate.id}/approve`, headers: authHeaders(), payload: { artistId, title: 'Thunderstruck' } });
    expect(result.statusCode).toBe(200);
    expect(await prisma.musicVideo.findMany()).toEqual([expect.objectContaining({ title: 'Thunderstruck', catalogKind: 'supplementary',
      sourcePublishedAt: new Date('1990-01-01T00:00:00Z') })]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/artist/summary', headers: authHeaders() })).json().items)
      .toEqual([expect.objectContaining({ id: artistId, name: 'AC/DC' })]);
  });

  it('refuses to approve a video under an unresolved artist', async () => {
    const candidate = await prisma.videoReviewCandidate.create({ data: {
      source: 'youtube', externalId: 'uncertain', artistId, artistName: 'AC/DC', title: 'Thunderstruck',
      url: 'https://www.youtube.com/watch?v=uncertain',
    } });
    const result = await app.inject({ method: 'POST', url: `/api/v1/video-review/${candidate.id}/approve`, headers: authHeaders(), payload: { artistId, title: 'Thunderstruck' } });
    expect(result.statusCode).toBe(409);
    expect(await prisma.musicVideo.count()).toBe(0);
  });

  it('pages and filters a large review queue on the server', async () => {
    await prisma.videoReviewCandidate.createMany({ data: [
      { source: 'youtube', externalId: 'one', artistId, artistName: 'AC/DC', title: 'Back in Black' },
      { source: 'youtube', externalId: 'two', artistId, artistName: 'AC/DC', title: 'Hells Bells' },
      { source: 'youtube', externalId: 'three', artistName: 'Other', title: 'Other Song' },
    ] });
    const first = await app.inject({ method: 'GET', url: `/api/v1/video-review/page?artistId=${artistId}&limit=1`, headers: authHeaders() });
    expect(first.json()).toMatchObject({ total: 2, limit: 1, items: [expect.objectContaining({ title: 'Back in Black' })] });
    const second = await app.inject({ method: 'GET', url: `/api/v1/video-review/page?artistId=${artistId}&limit=1&search=hells`, headers: authHeaders() });
    expect(second.json()).toMatchObject({ total: 1, items: [expect.objectContaining({ title: 'Hells Bells' })] });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createArtist } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('artist routes', () => {
  let app: FastifyInstance;
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('GET /api/v1/artist lists artists sorted by sortName', async () => {
    await createArtist(rootFolderId, qualityProfileId, { name: 'Zebra', sortName: 'Zebra' });
    await createArtist(rootFolderId, qualityProfileId, { name: 'Apple', sortName: 'Apple' });

    const res = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((a: { name: string }) => a.name);
    expect(names).toEqual(['Apple', 'Zebra']);
  });

  it('GET /api/v1/artist/:id returns the artist with its videos included', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);

    const res = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: artist.id, name: artist.name, musicVideos: [] });
  });

  it('GET /api/v1/artist/:id 404s for a nonexistent id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/artist/999999', headers: authHeaders() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Artist not found' });
  });

  it('POST /api/v1/artist creates an artist and derives sortName (stripping a leading "The")', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: 'The Beatles', rootFolderId, qualityProfileId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'The Beatles', sortName: 'Beatles', monitored: true, genre: null });
  });

  it('POST /api/v1/artist rejects a missing required field with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { rootFolderId, qualityProfileId }, // missing name
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ValidationError');
  });

  it('POST /api/v1/artist rejects an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: '', rootFolderId, qualityProfileId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/artist persists an explicit genre', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/artist',
      headers: authHeaders(),
      payload: { name: 'Genre Artist', rootFolderId, qualityProfileId, genre: 'Synthpop' },
    });
    expect(res.json().genre).toBe('Synthpop');
  });

  it('PUT /api/v1/artist/:id updates fields and re-derives sortName from a new name', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Old Name' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { name: 'An Updated Name' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'An Updated Name', sortName: 'Updated Name' });
  });

  it('PUT /api/v1/artist/:id toggling monitored on skips the metadata refresh when there is no imvdbArtistId', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Unmonitored' });
    await ensureSettings({ apiKey: TEST_API_KEY }); // no-op, keeps intent explicit
    // start unmonitored
    await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { monitored: false },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/artist/${artist.id}`,
      headers: authHeaders(),
      payload: { monitored: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().monitored).toBe(true);
    expect(res.json().videosAdded).toBeUndefined();
    expect(res.json().metadataRefreshError).toBeUndefined();
  });

  it('PUT /api/v1/artist/:id 404s (via the shared P2025 handler) for a nonexistent id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/artist/999999',
      headers: authHeaders(),
      payload: { name: 'Does not matter' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/v1/artist/:id removes the artist', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: `/api/v1/artist/${artist.id}`, headers: authHeaders() });
    expect(get.statusCode).toBe(404);
  });

  it('POST /api/v1/artist/:id/match-genre 404s cleanly when no provider has genre data (no providers enabled)', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'No Match Artist' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/artist/${artist.id}/match-genre`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('No standard genre match found');
  });
});

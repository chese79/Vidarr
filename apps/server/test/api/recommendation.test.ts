import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  resetDb,
  ensureSettings,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createRecommendation,
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('recommendation routes', () => {
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

  it('GET /api/v1/recommendation lists only non-dismissed, non-added recommendations, ordered by score', async () => {
    await createRecommendation({ artistName: 'Low Score', aggregateScore: 0.2 });
    await createRecommendation({ artistName: 'High Score', aggregateScore: 0.9 });
    await createRecommendation({ artistName: 'Dismissed', aggregateScore: 1.0, dismissed: true });

    const res = await app.inject({ method: 'GET', url: '/api/v1/recommendation', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((r: { artistName: string }) => r.artistName);
    expect(names).toEqual(['High Score', 'Low Score']);
  });

  it('POST /api/v1/recommendation/:id/dismiss removes it from the default list', async () => {
    const rec = await createRecommendation({ artistName: 'To Dismiss' });

    const dismiss = await app.inject({
      method: 'POST',
      url: `/api/v1/recommendation/${rec.id}/dismiss`,
      headers: authHeaders(),
    });
    expect(dismiss.statusCode).toBe(200);
    expect(dismiss.json().dismissed).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/v1/recommendation', headers: authHeaders() });
    expect(list.json()).toHaveLength(0);
  });

  it('POST /api/v1/recommendation/:id/add creates a real artist and links it back', async () => {
    const rec = await createRecommendation({ artistName: 'The New Artist' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/recommendation/${rec.id}/add`,
      headers: authHeaders(),
      payload: { rootFolderId, qualityProfileId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'The New Artist', sortName: 'New Artist' });

    const artistList = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: authHeaders() });
    expect(artistList.json()).toHaveLength(1);
  });

  it('POST /api/v1/recommendation/:id/add 404s for a nonexistent recommendation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/recommendation/999999/add',
      headers: authHeaders(),
      payload: { rootFolderId, qualityProfileId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/recommendation/:id/add rejects a missing rootFolderId', async () => {
    const rec = await createRecommendation({ artistName: 'Needs Root Folder' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/recommendation/${rec.id}/add`,
      headers: authHeaders(),
      payload: { qualityProfileId },
    });
    expect(res.statusCode).toBe(400);
  });
});

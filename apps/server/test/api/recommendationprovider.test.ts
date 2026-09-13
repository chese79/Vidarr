import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings, createRecommendationProviderConfig } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('recommendationprovider routes', () => {
  let app: FastifyInstance;

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
  });

  it('GET /api/v1/recommendationprovider lists configured providers', async () => {
    await createRecommendationProviderConfig({ provider: 'lastfm' });
    await createRecommendationProviderConfig({ provider: 'spotify' });

    const res = await app.inject({ method: 'GET', url: '/api/v1/recommendationprovider', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('PUT /api/v1/recommendationprovider/:provider updates credentials and enabled flag', async () => {
    await createRecommendationProviderConfig({ provider: 'lastfm', enabled: false });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/recommendationprovider/lastfm',
      headers: authHeaders(),
      payload: { enabled: true, apiKey: 'a-real-key' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: true, apiKey: 'a-real-key' });
  });

  it('PUT /api/v1/recommendationprovider/:provider 404s for a provider with no config row (P2025 -> 404)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/recommendationprovider/spotify',
      headers: authHeaders(),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

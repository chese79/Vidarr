import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings, createQuality } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('qualityprofile routes', () => {
  let app: FastifyInstance;
  let qualityId: number;

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
    qualityId = (await createQuality()).id;
  });

  it('GET /api/v1/quality lists seeded qualities ordered by weight', async () => {
    await createQuality({ name: '720p', weight: 10 });
    const res = await app.inject({ method: 'GET', url: '/api/v1/quality', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const weights = res.json().map((q: { weight: number }) => q.weight);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });

  it('POST /api/v1/qualityprofile creates a profile with nested items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/qualityprofile',
      headers: authHeaders(),
      payload: { name: 'HD Only', cutoffQualityId: qualityId, items: [{ qualityId, allowed: true }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'HD Only', items: [{ qualityId, allowed: true }] });
  });

  it('POST /api/v1/qualityprofile rejects an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/qualityprofile',
      headers: authHeaders(),
      payload: { name: '', cutoffQualityId: qualityId, items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/qualityprofile includes each profile\'s items', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/qualityprofile',
      headers: authHeaders(),
      payload: { name: 'Profile A', cutoffQualityId: qualityId, items: [{ qualityId, allowed: true }] },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/qualityprofile', headers: authHeaders() });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].items).toHaveLength(1);
  });

  it('DELETE /api/v1/qualityprofile/:id removes the profile', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/qualityprofile',
      headers: authHeaders(),
      payload: { name: 'Temp', cutoffQualityId: qualityId, items: [] },
    });
    const id = created.json().id;

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/qualityprofile/${id}`, headers: authHeaders() });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/v1/qualityprofile', headers: authHeaders() });
    expect(list.json()).toHaveLength(0);
  });
});

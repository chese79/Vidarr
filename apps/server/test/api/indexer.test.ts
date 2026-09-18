import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('indexer routes', () => {
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

  it('POST /api/v1/indexer creates an indexer, JSON-encoding categories and applying defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/indexer',
      headers: authHeaders(),
      payload: { name: 'My Indexer', implementation: 'Torznab', baseUrl: 'http://indexer.local', categories: [3020] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'My Indexer', categories: '[3020]', enabled: true, priority: 25 });
  });

  it('stores an indexer API key without returning it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/indexer',
      headers: authHeaders(),
      payload: { name: 'Secret', implementation: 'Torznab', baseUrl: 'http://indexer.local', apiKey: 'indexer-secret' },
    });
    expect(res.json()).toMatchObject({ apiKey: null, hasApiKey: true });
    expect(JSON.stringify(res.json())).not.toContain('indexer-secret');
  });

  it('POST /api/v1/indexer rejects an invalid implementation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/indexer',
      headers: authHeaders(),
      payload: { name: 'Bad', implementation: 'BitTorrent', baseUrl: 'http://x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/v1/indexer/:id only updates the fields provided', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/indexer',
      headers: authHeaders(),
      payload: { name: 'Original', implementation: 'Torznab', baseUrl: 'http://a', priority: 10 },
    });
    const id = created.json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/indexer/${id}`,
      headers: authHeaders(),
      payload: { priority: 50 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Original', baseUrl: 'http://a', priority: 50 });
  });

  it('DELETE /api/v1/indexer/:id removes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/indexer',
      headers: authHeaders(),
      payload: { name: 'Temp', implementation: 'Newznab', baseUrl: 'http://a' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/indexer/${created.json().id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });

  it('POST /api/v1/indexer/:id/test 404s for a nonexistent indexer', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/indexer/999999/test', headers: authHeaders() });
    expect(res.statusCode).toBe(404);
  });
});

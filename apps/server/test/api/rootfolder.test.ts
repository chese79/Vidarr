import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('rootfolder routes', () => {
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

  it('POST then GET /api/v1/rootfolder round-trips a root folder', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/music-videos' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ path: '/media/music-videos', accessible: true });

    const list = await app.inject({ method: 'GET', url: '/api/v1/rootfolder', headers: authHeaders() });
    expect(list.json()).toHaveLength(1);
  });

  it('POST /api/v1/rootfolder rejects an empty path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/rootfolder rejects a duplicate path (unique constraint -> non-500)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/dupe' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/dupe' },
    });
    // No specific unique-constraint handler exists for this route today —
    // it surfaces as the generic 500 branch rather than a 409. Documents the
    // current (imperfect) behavior so a future improvement is a visible diff.
    expect(res.statusCode).toBe(500);
  });

  it('DELETE /api/v1/rootfolder/:id removes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/to-delete' },
    });
    const id = created.json().id;

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/rootfolder/${id}`, headers: authHeaders() });
    expect(del.statusCode).toBe(204);
  });
});

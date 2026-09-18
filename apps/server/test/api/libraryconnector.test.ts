import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings, createLibraryConnector } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('libraryconnector routes', () => {
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

  it('POST /api/v1/libraryconnector creates a connector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'My Jellyfin', type: 'jellyfin', host: 'http://jellyfin:8096' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'My Jellyfin', type: 'jellyfin', enabled: true });
  });

  it('never returns connector tokens or passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: {
        name: 'Secret connector',
        type: 'jellyfin',
        host: 'jellyfin:8096',
        authToken: 'connector-secret',
        password: 'connector-password',
      },
    });

    expect(res.json()).toMatchObject({ authToken: null, hasAuthToken: true });
    expect(res.json()).not.toHaveProperty('password');
    expect(JSON.stringify(res.json())).not.toContain('connector-secret');
    expect(JSON.stringify(res.json())).not.toContain('connector-password');
  });

  it('POST /api/v1/libraryconnector prepends http:// to a bare host — a schemeless host makes every request fail with "Failed to parse URL"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'JF', type: 'jellyfin', host: '192.168.0.8:8096' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().host).toBe('http://192.168.0.8:8096');
  });

  it('POST /api/v1/libraryconnector leaves a host that already has a scheme untouched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'Secure Plex', type: 'plex', host: 'https://plex.example.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().host).toBe('https://plex.example.com');
  });

  it('POST /api/v1/libraryconnector rejects an invalid type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector',
      headers: authHeaders(),
      payload: { name: 'Bad', type: 'napster', host: 'http://x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/libraryconnector lists connectors', async () => {
    await createLibraryConnector({ name: 'A' });
    await createLibraryConnector({ name: 'B' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/libraryconnector', headers: authHeaders() });
    expect(res.json()).toHaveLength(2);
  });

  it('PUT /api/v1/libraryconnector/:id updates fields', async () => {
    const connector = await createLibraryConnector();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
      payload: { videoLibraryId: 'section-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().videoLibraryId).toBe('section-2');
  });

  it('PUT /api/v1/libraryconnector/:id also normalizes a schemeless host', async () => {
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
      payload: { host: '192.168.0.8:8096' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().host).toBe('http://192.168.0.8:8096');
  });

  it('PUT /api/v1/libraryconnector/:id updates host/token/username — fixing a bad credential without deleting the row', async () => {
    const connector = await createLibraryConnector({ name: 'My Jellyfin', type: 'jellyfin', host: 'http://old-host:8096' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
      payload: { host: 'http://new-host:8096', authToken: 'new-token', username: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ host: 'http://new-host:8096', authToken: null, hasAuthToken: true, username: 'admin' });
    expect(JSON.stringify(res.json())).not.toContain('new-token');
  });

  it('DELETE /api/v1/libraryconnector/:id removes it', async () => {
    const connector = await createLibraryConnector();
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/libraryconnector/${connector.id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });

  it('GET /api/v1/libraryconnector/:id/sections 404s for a nonexistent connector', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/libraryconnector/999999/sections',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/libraryconnector/:id/test 404s for a nonexistent connector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/999999/test',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/libraryconnector/:id/sync 404s for a nonexistent connector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/999999/sync',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/libraryconnector/:id/sync-play-counts propagates a real error as 502, not 500', async () => {
    // No real connector exists at this id at all — syncPlayCounts will fail
    // trying to look it up, and the route must translate that into a clean
    // 502 rather than letting an unhandled rejection surface as a 500.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/999999/sync-play-counts',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(502);
  });
});

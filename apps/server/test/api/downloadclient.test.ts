import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('downloadclient routes', () => {
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

  it('POST /api/v1/downloadclient creates a client, defaulting category to "vidarr"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/downloadclient',
      headers: authHeaders(),
      payload: { name: 'qBit', implementation: 'qBittorrent', host: 'http://localhost', port: 8080 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'qBit', category: 'vidarr', enabled: true });
  });

  it('stores download-client credentials without returning them', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/downloadclient',
      headers: authHeaders(),
      payload: {
        name: 'Secret client',
        implementation: 'SABnzbd',
        host: 'sabnzbd',
        port: 8080,
        password: 'download-password',
        apiKey: 'download-key',
      },
    });
    // Nulled with a has<Field> flag — same convention as indexers/connectors
    // — rather than the field just being absent, so the Edit form can show
    // "already set" without ever seeing the value.
    expect(res.json()).toMatchObject({ password: null, apiKey: null, hasPassword: true, hasApiKey: true });
    expect(JSON.stringify(res.json())).not.toContain('download-password');
    expect(JSON.stringify(res.json())).not.toContain('download-key');
  });

  it('PUT /api/v1/downloadclient/:id updates host/port/credentials without deleting the row', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/downloadclient',
      headers: authHeaders(),
      payload: { name: 'qBit', implementation: 'qBittorrent', host: 'old-host', port: 8080 },
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/downloadclient/${created.json().id}`,
      headers: authHeaders(),
      payload: { host: 'new-host', port: 9090, username: 'admin', password: 'new-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ host: 'new-host', port: 9090, username: 'admin', hasPassword: true });
    expect(JSON.stringify(res.json())).not.toContain('new-password');
  });

  it('POST /api/v1/downloadclient rejects a missing port', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/downloadclient',
      headers: authHeaders(),
      payload: { name: 'qBit', implementation: 'qBittorrent', host: 'http://localhost' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/v1/downloadclient/:id removes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/downloadclient',
      headers: authHeaders(),
      payload: { name: 'Temp', implementation: 'SABnzbd', host: 'http://x', port: 8081 },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/downloadclient/${created.json().id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });

  it('POST /api/v1/downloadclient/:id/test 404s for a nonexistent client', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/downloadclient/999999/test', headers: authHeaders() });
    expect(res.statusCode).toBe(404);
  });
});

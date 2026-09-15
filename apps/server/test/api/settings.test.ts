import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('settings routes', () => {
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

  it('GET /api/v1/config returns defaults on first access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/config', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      namingFormat: '{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]',
      transferMode: 'hardlink',
      minFreeSpaceMb: 1024,
    });
  });

  it('PUT /api/v1/config updates general settings', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/config',
      headers: authHeaders(),
      payload: { transferMode: 'copy', minFreeSpaceMb: 2048 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ transferMode: 'copy', minFreeSpaceMb: 2048 });
  });

  it('PUT /api/v1/config rejects an invalid transferMode', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/config',
      headers: authHeaders(),
      payload: { transferMode: 'teleport' },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /api/v1/config cannot set apiKey — it's stripped by UpdateSettingsSchema even if sent", async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/config',
      headers: authHeaders(),
      // apiKey is not part of UpdateSettingsSchema at all — Zod strips
      // unrecognized keys by default, so this must not change the real key.
      payload: { apiKey: 'attacker-supplied-key', minFreeSpaceMb: 999 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().apiKey).toBe(TEST_API_KEY);

    // and the attacker-supplied key must not actually authenticate
    const probe = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': 'attacker-supplied-key' },
    });
    expect(probe.statusCode).toBe(401);
  });

  it('PUT /api/v1/config cannot set adminPasswordHash directly — only POST /auth/login/credentials may, since it hashes the password', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/config',
      headers: authHeaders(),
      // adminPasswordHash is not part of UpdateSettingsSchema — a generic
      // settings PUT must never be able to plant an attacker-chosen "hash"
      // that would then successfully verify against some attacker-known
      // plaintext password (see apps/server/src/api/localAuth.ts).
      payload: { adminUsername: 'admin', adminPasswordHash: 'attacker-chosen-hash-value' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().adminPasswordHash).toBeNull();
  });

  it('POST /api/v1/config/regenerate-api-key rotates the key and invalidates the old one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/config/regenerate-api-key',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const newKey = res.json().apiKey;
    expect(newKey).toMatch(/^[0-9a-f]{64}$/);
    expect(newKey).not.toBe(TEST_API_KEY);

    const withOldKey = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: authHeaders() });
    expect(withOldKey.statusCode).toBe(401);

    const withNewKey = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': newKey },
    });
    expect(withNewKey.statusCode).toBe(200);
  });
});

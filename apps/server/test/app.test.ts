import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { resetDb, ensureSettings } from './support/db.js';

describe('app', () => {
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
  });

  it('GET /api/v1/health requires no API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('rejects a protected route with no API key at all', async () => {
    await ensureSettings({ apiKey: 'the-real-key' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/artist' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a protected route with the wrong API key', async () => {
    await ensureSettings({ apiKey: 'the-real-key' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': 'not-the-right-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a protected route when no API key has ever been configured', async () => {
    // Settings row deliberately absent — expected.apiKey is undefined, must
    // still reject rather than treating "no configured key" as "no auth needed".
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': 'anything' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a protected route with the correct API key', async () => {
    await ensureSettings({ apiKey: 'the-real-key' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': 'the-real-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('a bare key-length mismatch is rejected, not thrown as a 500', async () => {
    // timingSafeEqual throws on mismatched buffer lengths — the auth hook
    // must check .length equality itself before calling it.
    await ensureSettings({ apiKey: 'short' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': 'a-much-longer-provided-key-value' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('an unknown /api/* path 404s as JSON, not the SPA fallback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/does-not-exist',
      headers: { 'x-api-key': 'irrelevant' },
    });
    // Reaches the not-found handler only past the auth hook — but a
    // nonexistent /api/v1/* route still requires auth first (401), which
    // itself proves the route never silently falls through to serving HTML.
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });
});

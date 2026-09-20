import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb } from '../support/db.js';

// GET /api/v1/setup/bootstrap-key: reveals the API key exactly once, before
// first login, within a short window — never requires auth itself, so it's
// tested without any X-Api-Key header at all (see api/setup.ts).
describe('setup routes', () => {
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

  it('404s when no API key has ever been generated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(res.statusCode).toBe(404);
  });

  it('reveals the key, with no auth header at all, when freshly generated and never used', async () => {
    await prisma.settings.create({
      data: { id: 1, apiKey: 'fresh-key', apiKeyGeneratedAt: new Date() },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiKey: 'fresh-key' });
  });

  it('stops revealing the key permanently once it has been used to authenticate', async () => {
    await prisma.settings.create({
      data: { id: 1, apiKey: 'used-key', apiKeyGeneratedAt: new Date() },
    });

    // A real authenticated request — this is what actually flips
    // apiKeyFirstUsedAt, exercised via the real onRequest hook, not a
    // direct DB write.
    const authed = await app.inject({
      method: 'GET',
      url: '/api/v1/artist',
      headers: { 'x-api-key': 'used-key' },
    });
    expect(authed.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(res.statusCode).toBe(404);
  });

  it('stops revealing the key once its reveal window has expired, even if never used', async () => {
    const generatedAt = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago
    await prisma.settings.create({
      data: { id: 1, apiKey: 'stale-key', apiKeyGeneratedAt: generatedAt },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(res.statusCode).toBe(404);
  });

  // Regression test for a real gap: POST /api/v1/auth/setup can claim the
  // owner account without ever making an authenticated request itself, so
  // apiKeyFirstUsedAt stays null. Before this endpoint's claimability check
  // was unified with isInstanceClaimable() (see pipeline/auth.ts), the
  // bootstrap-key route only looked at apiKeyFirstUsedAt — meaning the raw
  // API key stayed revealable, unauthenticated, for the rest of the
  // 30-minute window even after an owner account already existed.
  it('stops revealing the key the moment an owner account is claimed via /auth/setup, even before any authenticated request', async () => {
    await prisma.settings.create({
      data: { id: 1, apiKey: 'claimable-key', apiKeyGeneratedAt: new Date() },
    });

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { username: 'owner', password: 'correct horse battery staple' },
    });
    expect(setup.statusCode).toBe(200);

    // apiKeyFirstUsedAt is still null here — nothing has ever authenticated
    // with the key yet — which is exactly the scenario that used to leave
    // the bootstrap-key route open.
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings?.apiKeyFirstUsedAt).toBeNull();

    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(res.statusCode).toBe(404);
  });

  it('does not require an X-Api-Key header — the route itself is exempt from auth', async () => {
    await prisma.settings.create({
      data: { id: 1, apiKey: 'no-auth-needed', apiKeyGeneratedAt: new Date() },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/setup/bootstrap-key',
      headers: { 'x-api-key': 'totally-wrong-value' },
    });
    // A wrong key on other routes 401s; this route ignores the header entirely.
    expect(res.statusCode).toBe(200);
  });
});

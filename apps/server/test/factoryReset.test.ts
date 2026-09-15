import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { factoryReset } from '../src/pipeline/factoryReset.js';
import { resetDb, ensureSettings } from './support/db.js';

// factoryReset() is the recovery tool for being fully locked out (see
// src/scripts/factoryReset.ts and README.md's "Recovering a lost API key").
// It is deliberately not exposed as an HTTP route — these tests exercise the
// pipeline function directly, plus (via app.inject) the real end-to-end
// effects it must have on live auth state, per this project's standing rule
// for security-sensitive changes: one test per invariant, not just the
// happy path.
describe('factoryReset', () => {
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

  it('generates a fresh apiKey different from the previous one', async () => {
    await ensureSettings({ apiKey: 'old-key' });
    const newKey = await factoryReset();
    expect(newKey).toMatch(/^[0-9a-f]{64}$/);
    expect(newKey).not.toBe('old-key');
  });

  it('the old apiKey stops authenticating once reset', async () => {
    await ensureSettings({ apiKey: 'old-key' });
    await factoryReset();
    const res = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: { 'x-api-key': 'old-key' } });
    expect(res.statusCode).toBe(401);
  });

  it('the new apiKey authenticates successfully', async () => {
    await ensureSettings({ apiKey: 'old-key' });
    const newKey = await factoryReset();
    const res = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: { 'x-api-key': newKey } });
    expect(res.statusCode).toBe(200);
  });

  it('clears the admin username/password login', async () => {
    await ensureSettings({ apiKey: 'old-key' });
    await prisma.settings.update({
      where: { id: 1 },
      data: { adminUsername: 'admin', adminPasswordHash: 'somehash:someotherhash' },
    });

    await factoryReset();

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings?.adminUsername).toBeNull();
    expect(settings?.adminPasswordHash).toBeNull();
    const status = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
    expect(status.json()).toEqual({ configured: false });
  });

  it('clears the Google Sign-On config', async () => {
    await ensureSettings({ apiKey: 'old-key' });
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        googleClientId: 'client-123',
        googleClientSecret: 'secret-abc',
        googleAllowedEmail: 'admin@example.com',
      },
    });

    await factoryReset();

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings?.googleClientId).toBeNull();
    expect(settings?.googleClientSecret).toBeNull();
    expect(settings?.googleAllowedEmail).toBeNull();
    const status = await app.inject({ method: 'GET', url: '/api/v1/auth/google/status' });
    expect(status.json()).toEqual({ configured: false });
  });

  it('re-arms the one-time bootstrap-reveal screen, even if it had already permanently closed', async () => {
    await ensureSettings({ apiKey: 'old-key' });
    // Actually authenticate once — this is what permanently closes the
    // bootstrap-reveal window under normal operation (see api/setup.ts).
    const authed = await app.inject({ method: 'GET', url: '/api/v1/artist', headers: { 'x-api-key': 'old-key' } });
    expect(authed.statusCode).toBe(200);
    const closedAlready = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(closedAlready.statusCode).toBe(404);

    const newKey = await factoryReset();

    const reopened = await app.inject({ method: 'GET', url: '/api/v1/setup/bootstrap-key' });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual({ apiKey: newKey });
  });

  it('works even when no Settings row exists yet at all', async () => {
    const newKey = await factoryReset();
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings?.apiKey).toBe(newKey);
  });
});

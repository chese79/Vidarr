import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';

// Username/password login is an alternative way to get vidarr's real apiKey
// into a browser (see apps/server/src/api/localAuth.ts) — not a parallel
// auth system, same relationship to apiKey as Google Sign-On. Every test
// here targets one specific invariant of that flow rather than just the
// happy path, per this project's standing rule for security-sensitive changes.
describe('local username/password login routes', () => {
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

  async function configureLogin(overrides: Partial<{ apiKey: string; username: string; password: string }> = {}) {
    const apiKey = overrides.apiKey ?? TEST_API_KEY;
    await ensureSettings({ apiKey });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/credentials',
      headers: { 'x-api-key': apiKey },
      payload: {
        username: overrides.username ?? 'admin',
        password: overrides.password ?? 'correct horse battery staple',
      },
    });
    expect(res.statusCode).toBe(200);
  }

  async function prepareFreshInstallation(apiKey = 'internal-key') {
    await ensureSettings({ apiKey });
    await prisma.settings.update({
      where: { id: 1 },
      data: { apiKeyGeneratedAt: new Date(), apiKeyFirstUsedAt: null },
    });
  }

  describe('GET /api/v1/auth/login/status', () => {
    it('reports not configured when nothing is set', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
      expect(res.json()).toEqual({ configured: false, setupAllowed: false });
    });

    it('reports configured once a username/password have been set', async () => {
      await configureLogin();
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
      expect(res.json()).toEqual({ configured: true, setupAllowed: false });
    });

    it('requires no API key itself', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('POST /api/v1/auth/setup', () => {
    it('lets an unclaimed installation create its owner without an API key', async () => {
      await prepareFreshInstallation();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: ' owner ', password: 'correct horse battery staple' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ apiKey: 'internal-key' });
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      expect(settings?.adminUsername).toBe('owner');
      expect(settings?.adminPasswordHash).toBeTruthy();
      expect(settings?.adminPasswordHash).not.toContain('correct horse battery staple');
    });

    it('can be claimed only once and cannot overwrite the owner account', async () => {
      await prepareFreshInstallation();
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'owner', password: 'first password123' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'attacker', password: 'second password456' },
      });
      expect(second.statusCode).toBe(409);

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'owner', password: 'first password123' },
      });
      expect(login.statusCode).toBe(200);
    });

    it('rejects weak setup credentials', async () => {
      await prepareFreshInstallation(TEST_API_KEY);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'owner', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
      const status = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
      expect(status.json()).toEqual({ configured: false, setupAllowed: true });
    });

    it('waits for server initialization when no internal key exists yet', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'owner', password: 'correct horse battery staple' },
      });
      expect(res.statusCode).toBe(503);
    });

    it('does not let an existing API-key installation be claimed', async () => {
      await ensureSettings({ apiKey: 'existing-key' });
      await prisma.settings.update({
        where: { id: 1 },
        data: { apiKeyGeneratedAt: new Date(), apiKeyFirstUsedAt: new Date() },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'attacker', password: 'correct horse battery staple' },
      });

      expect(res.statusCode).toBe(409);
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      expect(settings?.adminUsername).toBeNull();
    });

    it('closes owner setup after the bootstrap window expires', async () => {
      await ensureSettings({ apiKey: 'existing-key' });
      await prisma.settings.update({
        where: { id: 1 },
        data: { apiKeyGeneratedAt: new Date(Date.now() - 31 * 60 * 1000), apiKeyFirstUsedAt: null },
      });

      const status = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
      expect(status.json()).toEqual({ configured: false, setupAllowed: false });
      const setup = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { username: 'attacker', password: 'correct horse battery staple' },
      });
      expect(setup.statusCode).toBe(409);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('requires no API key itself — that would be circular', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'x', password: 'y' },
      });
      expect(res.statusCode).not.toBe(401);
    });

    it('400s when login is not configured at all', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'whatever' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('succeeds with the correct username and password and returns the real apiKey', async () => {
      await configureLogin({ apiKey: 'the-real-key', username: 'admin', password: 'correct horse battery staple' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'correct horse battery staple' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ apiKey: 'the-real-key' });
    });

    it('rejects a wrong password', async () => {
      await configureLogin({ username: 'admin', password: 'correct horse battery staple' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'wrong password' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a wrong username', async () => {
      await configureLogin({ username: 'admin', password: 'correct horse battery staple' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'not-admin', password: 'correct horse battery staple' },
      });
      expect(res.statusCode).toBe(401);
    });

    // A different error message for "wrong username" vs "wrong password" would
    // let an attacker enumerate whether a given username is the configured
    // one — both failure modes must be indistinguishable from the response.
    it('gives the exact same error for a wrong username and a wrong password', async () => {
      await configureLogin({ username: 'admin', password: 'correct horse battery staple' });
      const wrongUsername = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'not-admin', password: 'correct horse battery staple' },
      });
      const wrongPassword = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'wrong password' },
      });
      expect(wrongUsername.statusCode).toBe(wrongPassword.statusCode);
      expect(wrongUsername.json()).toEqual(wrongPassword.json());
    });

    it('is case-sensitive on the username', async () => {
      await configureLogin({ username: 'admin', password: 'correct horse battery staple' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'Admin', password: 'correct horse battery staple' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rate-limits repeated failed sign-in attempts', async () => {
      await configureLogin();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: 'admin', password: 'wrong password' },
        });
        expect(res.statusCode).toBe(401);
      }
      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'correct horse battery staple' },
      });
      expect(limited.statusCode).toBe(429);
    });

    it('reserves rate-limit slots before parallel password checks finish', async () => {
      await configureLogin();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { username: 'admin', password: 'wrong password' },
          }),
        ),
      );

      expect(responses.filter((res) => res.statusCode === 401)).toHaveLength(5);
      expect(responses.filter((res) => res.statusCode === 429)).toHaveLength(1);
    });
  });

  describe('POST /api/v1/auth/login/credentials', () => {
    it('requires an existing API key — otherwise anyone could set the admin login and hijack the account', async () => {
      await ensureSettings({ apiKey: TEST_API_KEY });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/credentials',
        payload: { username: 'admin', password: 'correct horse battery staple' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await ensureSettings({ apiKey: TEST_API_KEY });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/credentials',
        headers: authHeaders(),
        payload: { username: 'admin', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
      const status = await app.inject({ method: 'GET', url: '/api/v1/auth/login/status' });
      expect(status.json()).toEqual({ configured: false, setupAllowed: false });
    });

    it('rejects an empty username', async () => {
      await ensureSettings({ apiKey: TEST_API_KEY });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/credentials',
        headers: authHeaders(),
        payload: { username: '  ', password: 'correct horse battery staple' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('stores a hash, never the plaintext password', async () => {
      await configureLogin({ username: 'admin', password: 'correct horse battery staple' });
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      expect(settings?.adminPasswordHash).toBeTruthy();
      expect(settings?.adminPasswordHash).not.toBe('correct horse battery staple');
      expect(settings?.adminPasswordHash).not.toContain('correct horse battery staple');
    });

    it('rotates the login — the old password stops working and the new one works', async () => {
      await configureLogin({ username: 'admin', password: 'first password123' });
      await configureLogin({ username: 'admin', password: 'second password456' });

      const oldLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'first password123' },
      });
      expect(oldLogin.statusCode).toBe(401);

      const newLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'second password456' },
      });
      expect(newLogin.statusCode).toBe(200);
    });
  });
});

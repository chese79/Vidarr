import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings } from '../support/db.js';

// Google Sign-On is an alternative way to get vidarr's real apiKey into a
// browser (see apps/server/src/api/googleAuth.ts) — not a parallel auth
// system. Every test here targets one specific invariant of that flow
// rather than just the happy path, per this project's standing rule for
// security-sensitive changes.
describe('google auth routes', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function configureGoogle(overrides: Partial<{ apiKey: string; allowedEmail: string }> = {}) {
    await ensureSettings({ apiKey: overrides.apiKey ?? 'real-vidarr-api-key' });
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        googleClientId: 'client-123',
        googleClientSecret: 'secret-abc',
        googleAllowedEmail: overrides.allowedEmail ?? 'admin@example.com',
      },
    });
  }

  describe('GET /api/v1/auth/google/status', () => {
    it('reports not configured when nothing is set', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/status' });
      expect(res.json()).toEqual({ configured: false });
    });

    it('reports configured once client id/secret/allowed email are all set', async () => {
      await configureGoogle();
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/status' });
      expect(res.json()).toEqual({ configured: true });
    });

    it('requires no API key itself', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/status' });
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('GET /api/v1/auth/google/login', () => {
    it('400s when Google sign-in is not configured', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/login' });
      expect(res.statusCode).toBe(400);
    });

    it('redirects to Google with a state param and sets a matching state cookie', async () => {
      await configureGoogle();
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/login' });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.origin).toBe('https://accounts.google.com');
      expect(location.searchParams.get('client_id')).toBe('client-123');
      expect(location.searchParams.get('scope')).toContain('email');

      const stateCookie = res.cookies.find((c) => c.name === 'google_oauth_state');
      expect(stateCookie).toBeDefined();
      expect(stateCookie?.value).toBe(location.searchParams.get('state'));
      expect(stateCookie?.httpOnly).toBe(true);
    });
  });

  describe('GET /api/v1/auth/google/callback', () => {
    it('rejects when the query state does not match the cookie state (CSRF)', async () => {
      await configureGoogle();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=wrong-state',
        cookies: { google_oauth_state: 'real-state' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('google_error=state_mismatch');
    });

    it('rejects when there is no state cookie at all', async () => {
      await configureGoogle();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=some-state',
      });
      expect(res.headers.location).toContain('google_error=state_mismatch');
    });

    it('does not require an API key itself', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/callback?code=x&state=y' });
      expect(res.statusCode).not.toBe(401);
    });

    it('rejects an ID token whose audience is not this app (token replay from elsewhere)', async () => {
      await configureGoogle();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'https://oauth2.googleapis.com/token') {
            return { ok: true, json: async () => ({ id_token: 'fake' }) } as Response;
          }
          if (url.includes('tokeninfo')) {
            return {
              ok: true,
              json: async () => ({ aud: 'someone-elses-client-id', email: 'admin@example.com', email_verified: 'true' }),
            } as Response;
          }
          throw new Error(`unexpected fetch ${url}`);
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=s',
        cookies: { google_oauth_state: 's' },
      });
      expect(res.headers.location).toContain('google_error=audience_mismatch');
    });

    it('rejects an unverified email even if it matches the allowed address', async () => {
      await configureGoogle();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'https://oauth2.googleapis.com/token') {
            return { ok: true, json: async () => ({ id_token: 'fake' }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({ aud: 'client-123', email: 'admin@example.com', email_verified: 'false' }),
          } as Response;
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=s',
        cookies: { google_oauth_state: 's' },
      });
      expect(res.headers.location).toContain('google_error=email_not_verified');
    });

    it('rejects a verified email that is not the one allowed account', async () => {
      await configureGoogle({ allowedEmail: 'admin@example.com' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'https://oauth2.googleapis.com/token') {
            return { ok: true, json: async () => ({ id_token: 'fake' }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({ aud: 'client-123', email: 'someone-else@example.com', email_verified: 'true' }),
          } as Response;
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=s',
        cookies: { google_oauth_state: 's' },
      });
      expect(res.headers.location).toContain('google_error=not_allowed');
    });

    it('matches the allowed email case-insensitively', async () => {
      await configureGoogle({ apiKey: 'case-key', allowedEmail: 'Admin@Example.com' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'https://oauth2.googleapis.com/token') {
            return { ok: true, json: async () => ({ id_token: 'fake' }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({ aud: 'client-123', email: 'ADMIN@EXAMPLE.COM', email_verified: 'true' }),
          } as Response;
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=s',
        cookies: { google_oauth_state: 's' },
      });
      expect(res.headers.location).not.toContain('google_error');
      expect(res.headers.location).toContain('google_exchange=');
    });

    it('succeeds end-to-end for the correct, verified, allowed account and redirects with an exchange token', async () => {
      await configureGoogle({ apiKey: 'the-real-key', allowedEmail: 'admin@example.com' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'https://oauth2.googleapis.com/token') {
            return { ok: true, json: async () => ({ id_token: 'fake' }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({ aud: 'client-123', email: 'admin@example.com', email_verified: 'true' }),
          } as Response;
        }),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=s',
        cookies: { google_oauth_state: 's' },
      });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string, 'http://localhost');
      const exchangeToken = location.searchParams.get('google_exchange');
      expect(exchangeToken).toBeTruthy();

      // The exchange token, not the real key, is what rode in the redirect —
      // and it must actually work against the exchange endpoint.
      const exchangeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/google/exchange',
        payload: { token: exchangeToken },
      });
      expect(exchangeRes.statusCode).toBe(200);
      expect(exchangeRes.json()).toEqual({ apiKey: 'the-real-key' });
    });
  });

  describe('POST /api/v1/auth/google/exchange', () => {
    it('400s for an unknown/invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/google/exchange',
        payload: { token: 'never-issued' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s when no token is provided at all', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google/exchange', payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it('is single-use — a second exchange of the same token fails', async () => {
      await configureGoogle({ apiKey: 'single-use-key' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === 'https://oauth2.googleapis.com/token') {
            return { ok: true, json: async () => ({ id_token: 'fake' }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({ aud: 'client-123', email: 'admin@example.com', email_verified: 'true' }),
          } as Response;
        }),
      );
      const callback = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/google/callback?code=abc&state=s',
        cookies: { google_oauth_state: 's' },
      });
      const token = new URL(callback.headers.location as string, 'http://localhost').searchParams.get(
        'google_exchange',
      );

      const first = await app.inject({ method: 'POST', url: '/api/v1/auth/google/exchange', payload: { token } });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({ method: 'POST', url: '/api/v1/auth/google/exchange', payload: { token } });
      expect(second.statusCode).toBe(400);
    });

    it('does not require an API key itself — that would be circular', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google/exchange', payload: { token: 'x' } });
      expect(res.statusCode).not.toBe(401);
    });
  });
});

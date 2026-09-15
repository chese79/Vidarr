import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { createExchangeToken, consumeExchangeToken } from '../pipeline/googleAuthExchange.js';

const STATE_COOKIE = 'google_oauth_state';
const OAUTH_SCOPE = 'openid email';

function redirectUriFor(req: { protocol: string; headers: { host?: string } }): string {
  return `${req.protocol}://${req.headers.host}/api/v1/auth/google/callback`;
}

// Not a parallel auth system: a successful Google sign-in just hands the
// browser vidarr's real, existing apiKey — every /api/v1/* request still
// authenticates the same way it always has (see app.ts's onRequest hook).
// This is an alternative way to get the key into a browser, gated by "is
// this the one allowed Google account" instead of "did you already have it."
export async function googleAuthRoutes(app: FastifyInstance) {
  app.get('/api/v1/auth/google/status', async () => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    return {
      configured: Boolean(settings?.googleClientId && settings?.googleClientSecret && settings?.googleAllowedEmail),
    };
  });

  app.get('/api/v1/auth/google/login', async (req, reply) => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.googleClientId || !settings.googleClientSecret || !settings.googleAllowedEmail) {
      return reply.code(400).send({ error: 'Google sign-in is not configured.' });
    }

    // Anti-CSRF: an httpOnly cookie only this browser holds, checked against
    // the state Google echoes back on the callback redirect. sameSite=lax
    // (not strict) because the whole point of this cookie is to survive the
    // cross-site top-level GET redirect coming back from accounts.google.com.
    const state = randomBytes(24).toString('hex');
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth/google',
      maxAge: 300,
    });

    const params = new URLSearchParams({
      client_id: settings.googleClientId,
      redirect_uri: redirectUriFor(req),
      response_type: 'code',
      scope: OAUTH_SCOPE,
      state,
      prompt: 'select_account',
    });
    reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get('/api/v1/auth/google/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string };
    const cookieState = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/google' });

    if (!query.code || !query.state || !cookieState || query.state !== cookieState) {
      return reply.redirect('/?google_error=state_mismatch');
    }

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.googleClientId || !settings.googleClientSecret || !settings.googleAllowedEmail || !settings.apiKey) {
      return reply.redirect('/?google_error=not_configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: settings.googleClientId,
        client_secret: settings.googleClientSecret,
        redirect_uri: redirectUriFor(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      return reply.redirect('/?google_error=token_exchange_failed');
    }
    const tokenBody = (await tokenRes.json()) as { id_token?: string };
    if (!tokenBody.id_token) {
      return reply.redirect('/?google_error=token_exchange_failed');
    }

    // Verified via Google's own tokeninfo endpoint (Google validates the
    // signature server-side and hands back the decoded claims) rather than
    // checking the JWT signature ourselves — no JWKS-verification dependency
    // needed, at the cost of one extra round-trip.
    const infoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenBody.id_token)}`,
    );
    if (!infoRes.ok) {
      return reply.redirect('/?google_error=token_verification_failed');
    }
    const info = (await infoRes.json()) as { aud?: string; email?: string; email_verified?: string | boolean };

    // aud check: this ID token must have been issued *for our own client*,
    // not replayed from some other application's Google sign-in.
    if (info.aud !== settings.googleClientId) {
      return reply.redirect('/?google_error=audience_mismatch');
    }
    // Never trust an unverified email claim for an access decision.
    if (String(info.email_verified) !== 'true') {
      return reply.redirect('/?google_error=email_not_verified');
    }
    if (!info.email || info.email.toLowerCase() !== settings.googleAllowedEmail.toLowerCase()) {
      return reply.redirect('/?google_error=not_allowed');
    }

    const exchangeToken = createExchangeToken(settings.apiKey);
    reply.redirect(`/?google_exchange=${exchangeToken}`);
  });

  app.post('/api/v1/auth/google/exchange', async (req, reply) => {
    const body = req.body as { token?: string };
    const apiKey = body.token ? consumeExchangeToken(body.token) : null;
    if (!apiKey) {
      return reply.code(400).send({ error: 'This sign-in link has expired or already been used.' });
    }
    return { apiKey };
  });
}

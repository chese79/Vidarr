import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { LastFmError, lastFmCall } from '../providers/lastfmClient.js';
import { resetLastFmAccount, withLastFmLock } from '../pipeline/lastfmScrobbling.js';

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

async function credentials() {
  const config = await prisma.recommendationProviderConfig.findUnique({ where: { provider: 'lastfm' } });
  if (!config?.apiKey || !config.clientSecret) badRequest('Save your Last.fm API key and shared secret first.');
  return { apiKey: config.apiKey, secret: config.clientSecret };
}

async function authCall(apiKey: string, secret: string, method: string, args?: Record<string, string>) {
  try { return await lastFmCall(apiKey, secret, method, args); }
  catch (error) {
    if (error instanceof LastFmError) throw Object.assign(new Error(error.message), { statusCode: error.retryable ? 503 : 400 });
    throw error;
  }
}

export async function lastFmStatus() {
  const account = await prisma.lastFmAccount.findUnique({ where: { id: 1 } });
  const counts = await prisma.lastFmPlayback.groupBy({ by: ['status'], _count: { _all: true } });
  const count = (status: string) => counts.find((row) => row.status === status)?._count._all ?? 0;
  return {
    linked: Boolean(account?.sessionKey), username: account?.username ?? null,
    scrobblingEnabled: account?.scrobblingEnabled ?? false,
    pendingAuthorization: Boolean(account?.pendingToken && account.pendingExpiresAt && account.pendingExpiresAt > new Date()),
    pendingExpiresAt: account?.pendingExpiresAt ?? null,
    lastPollAt: account?.lastPollAt ?? null, lastScrobbledAt: account?.lastScrobbledAt ?? null,
    lastError: account?.lastError ?? null,
    queued: count('pending'), sent: count('sent'), ignored: count('ignored'), failed: count('failed'),
  };
}

// All routes inherit Vidarr API-key authentication. No unauthenticated
// callback, supplied token, password collection, or browser session secret.
export async function lastFmRoutes(app: FastifyInstance) {
  app.get('/api/v1/lastfm', lastFmStatus);
  app.post('/api/v1/lastfm/link', () => withLastFmLock(async () => {
    const { apiKey, secret } = await credentials();
    const response = await authCall(apiKey, secret, 'auth.getToken');
    if (typeof response.token !== 'string' || !response.token) badRequest('Last.fm returned no linking token.');
    const pending = { pendingToken: response.token, pendingExpiresAt: new Date(Date.now() + 60 * 60_000) };
    await prisma.lastFmAccount.upsert({ where: { id: 1 }, create: { id: 1, ...pending }, update: pending });
    const url = new URL('https://www.last.fm/api/auth/');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('token', response.token);
    return { authorizationUrl: url.toString() };
  }));
  app.post('/api/v1/lastfm/link/complete', () => withLastFmLock(async () => {
    const { apiKey, secret } = await credentials();
    const pending = await prisma.lastFmAccount.findUnique({ where: { id: 1 } });
    if (!pending?.pendingToken || !pending.pendingExpiresAt || pending.pendingExpiresAt <= new Date()) {
      badRequest('Account linking expired or has not started. Start a new link.');
    }
    const result = await authCall(apiKey, secret, 'auth.getSession', { token: pending.pendingToken });
    if (typeof result.session?.key !== 'string' || !result.session.key
      || typeof result.session?.name !== 'string' || !result.session.name) badRequest('Last.fm returned an invalid account session.');
    await prisma.$transaction([
      prisma.lastFmPlayback.deleteMany(),
      prisma.lastFmAccount.update({ where: { id: 1 }, data: {
        username: result.session.name, sessionKey: result.session.key, pendingToken: null, pendingExpiresAt: null,
        scrobblingEnabled: false, lastError: null, lastPollAt: null, lastScrobbledAt: null,
      } }),
    ]);
    return lastFmStatus();
  }));
  app.put('/api/v1/lastfm', (req) => withLastFmLock(async () => {
    const { scrobblingEnabled } = z.object({ scrobblingEnabled: z.boolean() }).strict().parse(req.body);
    const account = await prisma.lastFmAccount.findUnique({ where: { id: 1 } });
    if (!account?.sessionKey) badRequest('Link a Last.fm account first.');
    if (scrobblingEnabled) await credentials();
    // Disable drops pending sends and listening credit, so re-enabling cannot
    // publish playback observed during a previous authorization/enable period.
    await prisma.$transaction([
      ...(!scrobblingEnabled ? [prisma.lastFmPlayback.deleteMany()] : []),
      prisma.lastFmAccount.update({ where: { id: 1 }, data: { scrobblingEnabled, lastError: null } }),
    ]);
    return lastFmStatus();
  }));
  app.delete('/api/v1/lastfm', () => withLastFmLock(async () => {
    await resetLastFmAccount();
    return lastFmStatus();
  }));
}

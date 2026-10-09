import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings } from './support/db.js';
import { authHeaders, TEST_API_KEY } from './support/http.js';

let app: FastifyInstance;
let result: any;
beforeEach(async () => {
  await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY });
  await prisma.recommendationProviderConfig.create({ data: { provider: 'lastfm', apiKey: 'private-key', clientSecret: 'private-secret' } });
  result = { token: 'pending-private-token' };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => result })));
  app = await buildApp();
});
afterEach(async () => { await app.close(); vi.unstubAllGlobals(); });
async function post(url: string, payload?: any) { return app.inject({ method: 'POST', url, headers: authHeaders(), payload }); }
async function link() {
  await post('/api/v1/lastfm/link'); result = { session: { name: 'listener', key: 'private-session-key' } };
  return post('/api/v1/lastfm/link/complete');
}

describe('Last.fm account lifecycle', () => {
  it('requires Vidarr authentication on every endpoint', async () => {
    for (const [method, url] of [['GET', '/api/v1/lastfm'], ['POST', '/api/v1/lastfm/link'],
      ['POST', '/api/v1/lastfm/link/complete'], ['PUT', '/api/v1/lastfm'], ['DELETE', '/api/v1/lastfm']] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires both saved credentials before starting a link', async () => {
    await prisma.recommendationProviderConfig.update({ where: { provider: 'lastfm' }, data: { clientSecret: null } });
    expect((await post('/api/v1/lastfm/link')).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns only a Last.fm authorization link and persists the pending token server-side', async () => {
    const response = await post('/api/v1/lastfm/link'); expect(response.statusCode).toBe(200);
    const url = new URL(response.json().authorizationUrl);
    expect(url.origin).toBe('https://www.last.fm'); expect(url.searchParams.get('token')).toBe('pending-private-token');
    const status = await app.inject({ url: '/api/v1/lastfm', headers: authHeaders() });
    expect(status.json().pendingAuthorization).toBe(true);
    expect(status.body).not.toContain('pending-private-token'); expect(status.body).not.toContain('private-secret');
  });
  it('links the authorized account without returning its session key and leaves scrobbling opt-in', async () => {
    const response = await link(); expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ linked: true, username: 'listener', scrobblingEnabled: false, pendingAuthorization: false });
    expect(response.body).not.toContain('private-session-key');
    const account = await prisma.lastFmAccount.findFirst(); expect(account?.sessionKey).toBe('private-session-key');
    expect(account?.pendingToken).toBeNull();
    const args = new URLSearchParams(vi.mocked(fetch).mock.calls[1][1]?.body as URLSearchParams);
    expect(args.get('token')).toBe('pending-private-token');
  });
  it('rejects expired tokens without contacting Last.fm', async () => {
    await post('/api/v1/lastfm/link');
    await prisma.lastFmAccount.update({ where: { id: 1 }, data: { pendingExpiresAt: new Date(0) } });
    expect((await post('/api/v1/lastfm/link/complete')).statusCode).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps a pending link when authorization has not been granted yet', async () => {
    await post('/api/v1/lastfm/link'); result = { error: 14, message: 'private-secret' };
    const response = await post('/api/v1/lastfm/link/complete');
    expect(response.statusCode).toBe(400); expect(response.body).toContain('Authorize Vidarr');
    expect(response.body).not.toContain('private-secret');
    expect((await prisma.lastFmAccount.findFirst())?.pendingToken).not.toBeNull();
  });
  it('enables independently of recommendation lookups and discards queued plays on disable', async () => {
    await link();
    const enabled = await app.inject({ method: 'PUT', url: '/api/v1/lastfm', headers: authHeaders(), payload: { scrobblingEnabled: true } });
    expect(enabled.json().scrobblingEnabled).toBe(true);
    await prisma.lastFmPlayback.create({ data: { connectorId: 1, libraryId: 'videos', sessionId: 'device', externalId: 'item',
      artist: 'Artist', track: 'Song', durationSeconds: 120, startedAt: 1, lastObservedAt: new Date(), positionSeconds: 60,
      playing: true, status: 'pending' } });
    await app.inject({ method: 'PUT', url: '/api/v1/lastfm', headers: authHeaders(), payload: { scrobblingEnabled: false } });
    expect(await prisma.lastFmPlayback.count()).toBe(0);
    expect((await prisma.lastFmAccount.findFirst())?.sessionKey).not.toBeNull();
    expect((await prisma.recommendationProviderConfig.findFirst())?.enabled).toBe(false);
  });
  it('unlinks locally and never returns credentials from provider or account status', async () => {
    await link();
    const provider = await app.inject({ url: '/api/v1/recommendationprovider', headers: authHeaders() });
    expect(provider.json()[0]).toMatchObject({ apiKey: null, clientSecret: null, hasApiKey: true, hasClientSecret: true });
    expect(provider.body).not.toContain('private-');
    const unlinked = await app.inject({ method: 'DELETE', url: '/api/v1/lastfm', headers: authHeaders() });
    expect(unlinked.json()).toMatchObject({ linked: false, username: null, scrobblingEnabled: false });
    expect(await prisma.lastFmAccount.count()).toBe(0);
  });
  it('invalidates account authorization when API credentials change, but not for recommendation enablement', async () => {
    await link();
    await app.inject({ method: 'PUT', url: '/api/v1/recommendationprovider/lastfm', headers: authHeaders(), payload: { enabled: true } });
    expect((await prisma.lastFmAccount.findFirst())?.sessionKey).not.toBeNull();
    await app.inject({ method: 'PUT', url: '/api/v1/recommendationprovider/lastfm', headers: authHeaders(), payload: { clientSecret: 'replacement' } });
    expect(await prisma.lastFmAccount.count()).toBe(0);
  });
});

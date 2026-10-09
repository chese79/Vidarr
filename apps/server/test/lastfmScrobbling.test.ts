import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import { pollLastFmPlayback } from '../src/pipeline/lastfmScrobbling.js';
import { lastFmSignature, lastFmCall } from '../src/providers/lastfmClient.js';
import { resetDb, createLibraryConnector } from './support/db.js';

const start = new Date('2026-10-08T20:00:00Z');
const session = { sessionId: 'device:user1', externalId: 'video1', artistName: 'Björk', title: 'Jóga',
  durationSeconds: 120, positionSeconds: 0, playing: true };
const accepted = { scrobbles: { '@attr': { accepted: '1', ignored: '0' } } };
let positions: typeof session[];
let connectorId: number;
let calls: { method: string; args: URLSearchParams }[];
let response: any;

beforeEach(async () => {
  await resetDb();
  const connector = await createLibraryConnector();
  connectorId = connector.id;
  await prisma.libraryConnector.update({ where: { id: connector.id }, data: { videoLibraryId: 'videos' } });
  await prisma.recommendationProviderConfig.create({ data: { provider: 'lastfm', apiKey: 'key', clientSecret: 'secret', enabled: false } });
  await prisma.lastFmAccount.create({ data: { id: 1, username: 'listener', sessionKey: 'session-secret', scrobblingEnabled: true } });
  positions = [{ ...session }]; calls = []; response = accepted;
  vi.spyOn(jellyfinProvider, 'fetchPlaybackSessions').mockImplementation(async () => positions);
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const args = new URLSearchParams(init.body);
    const method = args.get('method')!;
    calls.push({ method, args });
    return { ok: true, status: 200, json: async () => method === 'track.updateNowPlaying' ? { nowplaying: {} } : response };
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function tick(seconds: number, position = seconds, playing = true) {
  positions = [{ ...session, positionSeconds: position, playing }];
  return pollLastFmPlayback(new Date(start.getTime() + seconds * 1000));
}
async function qualify() { for (const seconds of [0, 15, 30, 45, 60]) await tick(seconds); }

describe('observed scrobbling', () => {
  it('sends one signed now-playing update and one qualified scrobble, independent of recommendations', async () => {
    await qualify(); await tick(75); await tick(90);
    expect(calls.map((call) => call.method)).toEqual(['track.updateNowPlaying', 'track.scrobble']);
    const args = calls[1].args;
    expect(args.get('artist')).toBe('Björk'); expect(args.get('track')).toBe('Jóga');
    expect(args.get('timestamp')).toBe(String(start.getTime() / 1000));
    expect(args.get('sk')).toBe('session-secret');
    expect(args.get('api_sig')).toBe(lastFmSignature(Object.fromEntries(args), 'secret'));
    expect((await prisma.lastFmPlayback.findFirst())?.status).toBe('sent');
  });
  it('does not send historical play counts or any request when disabled', async () => {
    await prisma.lastFmAccount.update({ where: { id: 1 }, data: { scrobblingEnabled: false } });
    await qualify(); expect(calls).toEqual([]); expect(await prisma.lastFmPlayback.count()).toBe(0);
  });
  it('does not credit pauses, buffering, seeks, or a long observation gap', async () => {
    await tick(0); await tick(15, 15); await tick(30, 15, false);
    await tick(45, 15); await tick(60, 100); await tick(120, 115);
    const play = await prisma.lastFmPlayback.findFirst();
    expect(play?.listenedSeconds).toBe(15); expect(play?.status).toBeNull();
    expect(calls.filter((call) => call.method === 'track.scrobble')).toHaveLength(0);
  });
  it('rejects missing, non-finite, or too-short durations and unknown metadata', async () => {
    positions = [30, 0, NaN, Infinity].map((durationSeconds, i) => ({ ...session, durationSeconds, sessionId: String(i) }));
    positions.push({ ...session, artistName: 'Unknown Artist' });
    await pollLastFmPlayback(start); expect(calls).toEqual([]); expect(await prisma.lastFmPlayback.count()).toBe(0);
  });
  it('does not credit the already-played portion when joining mid-play', async () => {
    await tick(0, 80); await tick(15, 95); await tick(30, 110);
    expect((await prisma.lastFmPlayback.findFirst())?.listenedSeconds).toBe(30);
    expect(calls.map((call) => call.method)).toEqual(['track.updateNowPlaying']);
  });
  it('tracks all users independently', async () => {
    for (const seconds of [0, 15, 30, 45, 60]) {
      positions = [{ ...session, positionSeconds: seconds }, { ...session, sessionId: 'device:user2', positionSeconds: seconds }];
      await pollLastFmPlayback(new Date(start.getTime() + seconds * 1000));
    }
    expect(await prisma.lastFmPlayback.count({ where: { status: 'sent' } })).toBe(2);
  });
  it('queues an outage durably, backs off, and retries with the original timestamp', async () => {
    response = { error: 16, message: 'secret remote body must not escape' };
    await qualify(); expect((await prisma.lastFmPlayback.findFirst())?.status).toBe('pending');
    await tick(75); expect(calls.filter((call) => call.method === 'track.scrobble')).toHaveLength(1);
    response = accepted; await tick(90);
    const scrobbles = calls.filter((call) => call.method === 'track.scrobble');
    expect(scrobbles).toHaveLength(2); expect(scrobbles[0].args.get('timestamp')).toBe(scrobbles[1].args.get('timestamp'));
    expect((await prisma.lastFmPlayback.findFirst())?.status).toBe('sent');
  });
  it('records ignored responses without retrying them or counting them as sent', async () => {
    response = { scrobbles: { '@attr': { accepted: '0', ignored: '1' }, scrobble: { ignoredMessage: { code: '1' } } } };
    await qualify(); await tick(75);
    expect((await prisma.lastFmPlayback.findFirst())?.status).toBe('ignored');
    expect((await prisma.lastFmAccount.findFirst())?.lastScrobbledAt).toBeNull();
    expect(calls.filter((call) => call.method === 'track.scrobble')).toHaveLength(1);
  });
  it('stops and requires relinking when Last.fm revokes the session', async () => {
    response = { error: 9 }; await qualify(); await tick(75);
    const account = await prisma.lastFmAccount.findFirst();
    expect(account?.scrobblingEnabled).toBe(false); expect(account?.sessionKey).toBeNull();
    expect(account?.lastError).toContain('Link your account again');
    expect(calls.filter((call) => call.method === 'track.scrobble')).toHaveLength(1);
  });
  it('marks permanent failures without retrying', async () => {
    response = { error: 6 }; await qualify(); await tick(75);
    expect((await prisma.lastFmPlayback.findFirst())?.status).toBe('failed');
    expect(calls.filter((call) => call.method === 'track.scrobble')).toHaveLength(1);
  });
  it('makes a new play when the same track finishes then restarts', async () => {
    await qualify(); await tick(75); await tick(90); await tick(105); await tick(120, 0);
    for (const seconds of [135, 150, 165, 180]) await tick(seconds, seconds - 120);
    expect(await prisma.lastFmPlayback.count({ where: { status: 'sent' } })).toBe(2);
  });
  it('discards queued playback after changing the selected library', async () => {
    response = { error: 16 }; await qualify(); positions = [];
    await prisma.libraryConnector.update({ where: { id: connectorId }, data: { videoLibraryId: 'other' } });
    await pollLastFmPlayback(new Date(start.getTime() + 90_000));
    expect(await prisma.lastFmPlayback.count()).toBe(0);
    expect(calls.filter((call) => call.method === 'track.scrobble')).toHaveLength(1);
  });
  it('serializes concurrent polls instead of queuing duplicate plays', async () => {
    await Promise.all([pollLastFmPlayback(start), pollLastFmPlayback(start)]);
    expect(await prisma.lastFmPlayback.count()).toBe(1); expect(calls).toHaveLength(1);
  });
  it('does not infer listening over a failed connector read', async () => {
    await tick(0); await tick(15);
    vi.mocked(jellyfinProvider.fetchPlaybackSessions!).mockRejectedValueOnce(new Error('token=private'));
    await tick(30); await tick(45);
    expect((await prisma.lastFmPlayback.findFirst())?.listenedSeconds).toBe(15);
    expect(JSON.stringify(await prisma.lastFmAccount.findFirst())).not.toContain('private');
  });
  it('qualifies long videos after four minutes instead of half their duration', async () => {
    for (let seconds = 0; seconds <= 240; seconds += 15) {
      positions = [{ ...session, durationSeconds: 900, positionSeconds: seconds }];
      await pollLastFmPlayback(new Date(start.getTime() + seconds * 1000));
    }
    expect((await prisma.lastFmPlayback.findFirst())?.status).toBe('sent');
  });
});

describe('Last.fm transport', () => {
  it('uses HTTPS POST, a timeout, and hides secrets even when remote errors echo them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: 13, message: 'session-secret' }) })));
    await expect(lastFmCall('key', 'secret', 'track.scrobble')).rejects.toThrow('Check the API key');
    await expect(lastFmCall('key', 'secret', 'track.scrobble')).rejects.not.toThrow('session-secret');
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(init?.method).toBe('POST'); expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('treats network failures as retryable without exposing fetch messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('api_key=private')));
    await expect(lastFmCall('key', 'secret', 'auth.getToken')).rejects.toMatchObject({ retryable: true, code: null });
    await expect(lastFmCall('key', 'secret', 'auth.getToken')).rejects.not.toThrow('private');
  });
  it('signs the documented auth example and excludes response-format fields', () => {
    expect(lastFmSignature({ token: 'yyyyyy', method: 'auth.getSession', api_key: 'xxxxxxxxxx', format: 'json', callback: 'unused' }, 'ilovecher'))
      .toBe('b87d61da3cda91a8b6746c4aef55d6f8');
  });
});

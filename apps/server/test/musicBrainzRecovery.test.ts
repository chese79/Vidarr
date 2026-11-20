import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { musicBrainzRequest, musicBrainzRetryAt, resetMusicBrainzTransport } from '../src/providers/metadata/musicBrainzTransport.js';
import { searchMusicBrainzArtists, clearMusicBrainzCache } from '../src/providers/metadata/musicbrainz.js';
import { createMusicBrainzProvider } from '../src/providers/recommendation/musicbrainz.js';

afterEach(() => { clearMusicBrainzCache(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('honors Retry-After and a shared cooldown, then recovers without caching the failure', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': '120' } }))
    .mockResolvedValue(new Response(JSON.stringify({ artists: [] })));
  vi.stubGlobal('fetch', fetch);
  await expect(searchMusicBrainzArtists('first')).rejects.toThrow('503');
  expect(musicBrainzRetryAt()?.getTime()).toBe(120000);
  const blocked = expect(musicBrainzRequest('/artist/another?fmt=json')).rejects.toThrow('503');
  await vi.advanceTimersByTimeAsync(1100); await blocked;
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(118900);
  expect(await searchMusicBrainzArtists('first')).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2); expect(musicBrainzRetryAt()).toBeNull();
});

it('serializes recommendation and metadata calls through one lane without overlapping', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const starts: number[] = []; let active = 0, max = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    starts.push(Date.now()); max = Math.max(max, ++active);
    await new Promise(resolve => setTimeout(resolve, 2000)); active--;
    return new Response(JSON.stringify({ artists: [] }));
  }));
  const jobs = [searchMusicBrainzArtists('metadata'), createMusicBrainzProvider().getSimilarArtists(['recommendation'])];
  await vi.runAllTimersAsync(); await Promise.all(jobs);
  expect(starts).toHaveLength(2); expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100); expect(max).toBe(1);
});

it('backs off network failures and HTTP-date overloads but does not retry permanent 404s', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-20T00:00:00Z'));
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('connection reset'))
    .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': 'Fri, 20 Nov 2026 00:03:00 GMT' } }))
    .mockResolvedValue(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  await expect(musicBrainzRequest('/a')).rejects.toThrow('temporary network');
  await vi.advanceTimersByTimeAsync(30000);
  await expect(musicBrainzRequest('/a')).rejects.toThrow('503');
  expect(musicBrainzRetryAt()?.toISOString()).toBe('2026-11-20T00:03:00.000Z');
  await vi.advanceTimersByTimeAsync(150000);
  await expect(musicBrainzRequest('/a')).rejects.toThrow('404'); expect(musicBrainzRetryAt()).toBeNull();
});

it('reads actual HTTP overload headers and suppresses extra wire calls during an outage', async () => {
  const realFetch = globalThis.fetch; let calls = 0;
  const server = createServer((request, response) => {
    calls++; expect(request.headers['user-agent']).toContain('Vidarr/');
    if (request.url !== '/artist?fmt=json') { response.writeHead(501); response.end(); return; }
    response.writeHead(503, { 'Retry-After': '90' }); response.end('temporarily unavailable');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => realFetch(url.replace('https://musicbrainz.org/ws/2', `http://127.0.0.1:${address.port}`), options));
  try {
    const before = Date.now(); await expect(musicBrainzRequest('/artist?fmt=json')).rejects.toThrow('503');
    expect(musicBrainzRetryAt()!.getTime()).toBeGreaterThanOrEqual(before + 90000);
    await expect(musicBrainzRequest('/artist?fmt=json')).rejects.toThrow('503'); expect(calls).toBe(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { prisma } from '../src/db/client.js';
import { pollPlaybackMonitor, getNowPlaying, playbackScope } from '../src/pipeline/playbackMonitor.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import { resetDb, ensureSettings, createLibraryConnector, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createMusicVideoFile, createLibraryVideo } from './support/db.js';
import type { LibraryConnector } from '@prisma/client';

let sessions: unknown[] = [], count: number | undefined = 0, sessionStatus = 200, itemStatus = 200, itemId = 'native-a';
let calls: Array<{ path: string; method: string }> = [];
let holdItem: Promise<void> | undefined, releaseItem: (() => void) | undefined;
let connector: LibraryConnector, videoId: number, fileId: number, libraryVideoId: number;
const now = new Date('2026-11-18T12:00:00Z');
const session = (id = 'roku', overrides: Record<string, unknown> = {}) => ({ Id: id, UserId: 'owner', UserName: 'Owner', DeviceName: 'Roku', PlaySessionId: 'first',
  NowPlayingItem: { Id: 'native-a', Type: 'MusicVideo', Name: 'Native title', Artists: ['Native artist'], RunTimeTicks: 200 * 10_000_000 },
  PlayState: { PositionTicks: 100 * 10_000_000, IsPaused: false }, ...overrides });
const server = createServer(async (req, res) => {
  const path = req.url!; calls.push({ path, method: req.method! });
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'MediaBrowser Token="test-token"') { res.writeHead(401).end('{}'); return; }
  if (path === '/Sessions') { res.writeHead(sessionStatus).end(JSON.stringify(sessions)); return; }
  if (path === '/Users/owner/Items/native-a') {
    if (holdItem) await holdItem;
    if (!res.destroyed) res.writeHead(itemStatus).end(JSON.stringify({ Id: itemId, Type: 'MusicVideo', UserData: { PlayCount: count, Played: true } }));
    return;
  }
  res.writeHead(501).end(JSON.stringify({ error: 'Unexpected dependency request' }));
});
beforeAll(async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); });
afterAll(async () => { releaseItem?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(async () => {
  releaseItem?.(); releaseItem = undefined; holdItem = undefined;
  sessions = []; count = 0; sessionStatus = 200; itemStatus = 200; itemId = 'native-a'; calls = [];
  await resetDb(); await ensureSettings();
  const port = (server.address() as { port: number }).port;
  connector = await createLibraryConnector({ host: `http://127.0.0.1:${port}` });
  connector = await prisma.libraryConnector.update({ where: { id: connector.id }, data: { userId: 'owner', authToken: 'test-token', videoLibraryId: 'videos' } });
  const root = await createRootFolder(); await prisma.rootFolder.update({ where: { id: root.id }, data: { targetConnectorId: connector.id } });
  const artist = await createArtist(root.id, (await createQualityProfile((await createQuality()).id)).id);
  const video = await createMusicVideo(artist.id, { title: 'Canonical song', hasFile: true }); videoId = video.id;
  fileId = (await createMusicVideoFile(videoId, { playCount: 0 })).id;
  const copy = await createLibraryVideo(connector.id, { externalId: 'native-a', musicVideoId: videoId, playCount: 0 }); libraryVideoId = copy.id;
  await prisma.libraryVideo.update({ where: { id: copy.id }, data: { libraryId: 'videos' } });
  await prisma.scheduledTask.create({ data: { name: 'Playback Monitor', intervalMs: 15_000, lastRunAt: now, lastResult: 'success' } });
});
const nativeCalls = () => calls.filter(call => call.path.startsWith('/Users/'));
async function counts() { return { inventory: (await prisma.libraryVideo.findUniqueOrThrow({ where: { id: libraryVideoId } })).playCount,
  file: (await prisma.musicVideoFile.findUniqueOrThrow({ where: { id: fileId } })).playCount }; }

it('imports only the completed item native count and publishes its exact management target', async () => {
  sessions = [session()]; await pollPlaybackMonitor(now);
  const playing = await getNowPlaying(now);
  expect(playing.items).toHaveLength(1); expect(playing.items[0]).toMatchObject({ musicVideoId: videoId, title: 'Canonical song', playing: true, deviceName: 'Roku' });
  expect(JSON.stringify(playing)).not.toContain('test-token'); expect(nativeCalls()).toHaveLength(0);
  sessions = []; count = 1; await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect(await counts()).toEqual({ inventory: 1, file: 1 });
  expect(nativeCalls()).toEqual([{ path: '/Users/owner/Items/native-a', method: 'GET' }]);
  expect(calls.every(call => call.path === '/Sessions' || call.path === '/Users/owner/Items/native-a')).toBe(true);
  expect(await prisma.playCountRefresh.count()).toBe(0);
  await pollPlaybackMonitor(new Date(now.getTime() + 30_000));
  expect(nativeCalls()).toHaveLength(1); expect(await counts()).toEqual({ inventory: 1, file: 1 });
});

it('pausing does not trigger a count; two players finishing the same item do not double-count', async () => {
  sessions = [session('one'), session('two')]; await pollPlaybackMonitor(now);
  sessions = [session('one', { PlayState: { PositionTicks: 100 * 10_000_000, IsPaused: true } }), session('two')];
  await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect((await getNowPlaying(now)).items.some(item => !item.playing)).toBe(true);
  expect(nativeCalls()).toHaveLength(0);
  sessions = []; count = 2; await pollPlaybackMonitor(new Date(now.getTime() + 30_000));
  expect(await counts()).toEqual({ inventory: 2, file: 2 }); expect(nativeCalls()).toHaveLength(1);
});

it('uses a new play-session identity for repeat-one playback of the same video', async () => {
  sessions = [session()]; await pollPlaybackMonitor(now);
  count = 1; sessions = [session('roku', { PlaySessionId: 'repeat', PlayState: { PositionTicks: 0, IsPaused: false } })];
  await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect(await counts()).toEqual({ inventory: 1, file: 1 }); expect(nativeCalls()).toHaveLength(1);
});

it('retains pending single-item work on failure, respects retry timing and recovers', async () => {
  sessions = [session()]; await pollPlaybackMonitor(now);
  sessions = []; itemStatus = 503;
  await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect(await counts()).toEqual({ inventory: 0, file: 0 }); expect(await prisma.playCountRefresh.count()).toBe(1);
  await pollPlaybackMonitor(new Date(now.getTime() + 20_000)); expect(nativeCalls()).toHaveLength(1);
  itemStatus = 200; count = 1;
  await pollPlaybackMonitor(new Date(now.getTime() + 31_000));
  expect(await counts()).toEqual({ inventory: 1, file: 1 }); expect(nativeCalls()).toHaveLength(2); expect(await prisma.playCountRefresh.count()).toBe(0);
});

it('does not interpret a failed session snapshot as video completion and labels stale playback', async () => {
  sessions = [session()]; await pollPlaybackMonitor(now);
  sessionStatus = 503;
  await expect(pollPlaybackMonitor(new Date(now.getTime() + 15_000))).rejects.toThrow('unavailable');
  expect(await prisma.playbackObservation.count()).toBe(1); expect(await prisma.playCountRefresh.count()).toBe(0); expect(nativeCalls()).toHaveLength(0);
  const old = await getNowPlaying(new Date(now.getTime() + 60_000)); expect(old.stale).toBe(true); expect(old.items).toHaveLength(1);
});

it('keeps unknown counts unknown and imports a real zero without fabricating a viewing', async () => {
  await prisma.libraryVideo.update({ where: { id: libraryVideoId }, data: { playCount: null } });
  await prisma.musicVideoFile.update({ where: { id: fileId }, data: { playCount: null } });
  sessions = [session()]; await pollPlaybackMonitor(now); sessions = []; count = undefined;
  await pollPlaybackMonitor(new Date(now.getTime() + 15_000)); expect(await counts()).toEqual({ inventory: null, file: null });
  count = 0; await pollPlaybackMonitor(new Date(now.getTime() + 31_000)); expect(await counts()).toEqual({ inventory: 0, file: 0 });
  expect(await prisma.qualifiedPlayback.count()).toBe(0);
});

it('shows other profiles but does not overwrite the selected profile count from their completion', async () => {
  sessions = [session('guest', { UserId: 'guest', UserName: 'Guest' })]; await pollPlaybackMonitor(now);
  expect((await getNowPlaying(now)).items[0].userName).toBe('Guest');
  sessions = []; count = 3; await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect(nativeCalls()).toHaveLength(0); expect(await counts()).toEqual({ inventory: 0, file: 0 });
});

it('rejects wrong-scope and non-video sessions and never fetches a whole library', async () => {
  await prisma.libraryVideo.update({ where: { id: libraryVideoId }, data: { libraryId: 'another-library' } });
  sessions = [session()]; await pollPlaybackMonitor(now); expect((await getNowPlaying(now)).items).toHaveLength(0);
  await prisma.libraryVideo.update({ where: { id: libraryVideoId }, data: { libraryId: 'videos' } });
  sessions = [session('movie', { NowPlayingItem: { Id: 'native-a', Type: 'Movie' } })];
  await pollPlaybackMonitor(new Date(now.getTime() + 15_000)); expect((await getNowPlaying(now)).items).toHaveLength(0);
  expect(calls.every(call => call.path === '/Sessions')).toBe(true);
});

it('does not publish an uncertain catalog match as a direct artist-video link', async () => {
  await prisma.libraryVideo.update({ where: { id: libraryVideoId }, data: { matchConfidence: 'probable' } });
  sessions = [session()]; await pollPlaybackMonitor(now);
  expect((await getNowPlaying(now)).items[0]).toMatchObject({ musicVideoId: null, artistId: null });
  sessions = []; count = 1; await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect(await counts()).toEqual({ inventory: 1, file: 0 });
});

it('recovers a saved session after restart and defers counts only while video inventory is being written', async () => {
  await prisma.playbackObservation.create({ data: { connectorId: connector.id, scope: playbackScope(connector), sessionId: 'saved', userId: 'owner',
    externalId: 'native-a', title: 'Saved song', positionSeconds: 190, playing: true, lastSeenAt: new Date(now.getTime() - 60_000) } });
  await prisma.libraryConnector.update({ where: { id: connector.id }, data: { syncRunning: true, videoSyncRunning: true } });
  count = 1; await pollPlaybackMonitor(now); expect(nativeCalls()).toHaveLength(0); expect(await prisma.playCountRefresh.count()).toBe(1);
  await prisma.libraryConnector.update({ where: { id: connector.id }, data: { videoSyncRunning: false } });
  await pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  expect(await counts()).toEqual({ inventory: 1, file: 1 }); expect(nativeCalls()).toHaveLength(1);
});

it('discards a late response when the connector scope changes', async () => {
  sessions = [session()]; await pollPlaybackMonitor(now); sessions = []; count = 1;
  holdItem = new Promise(resolve => { releaseItem = resolve; });
  const pending = pollPlaybackMonitor(new Date(now.getTime() + 15_000));
  while (!nativeCalls().length) await new Promise(resolve => setTimeout(resolve, 5));
  await prisma.libraryConnector.update({ where: { id: connector.id }, data: { videoLibraryId: 'changed' } });
  releaseItem!(); await pending;
  expect(await counts()).toEqual({ inventory: 0, file: 0 });
  holdItem = undefined;
  await pollPlaybackMonitor(new Date(now.getTime() + 30_000)); expect(await prisma.playCountRefresh.count()).toBe(0);
});

it('rejects mismatched item identities and invalid counts instead of updating a different video', async () => {
  itemId = 'another-id'; await expect(jellyfinProvider.fetchItemPlayCount!(connector, 'native-a')).rejects.toThrow('different video');
  itemId = 'native-a'; count = -1; await expect(jellyfinProvider.fetchItemPlayCount!(connector, 'native-a')).rejects.toThrow('invalid native');
  expect(await counts()).toEqual({ inventory: 0, file: 0 });
});

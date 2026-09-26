import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  resetDb,
  ensureSettings,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
  createMusicVideoFile,
  createLibraryConnector,
  createLibraryVideo,
} from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';
import { prisma } from '../../src/db/client.js';

describe('playlist routes', () => {
  let app: FastifyInstance;
  let artistId: number;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const qualityProfile = await createQualityProfile(quality.id);
    artistId = (await createArtist(rootFolder.id, qualityProfile.id)).id;
  });

  it('POST /api/v1/playlist creates an empty playlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist',
      headers: authHeaders(),
      payload: { name: 'My Playlist' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'My Playlist', items: [], syncs: [] });
  });

  it('POST /api/v1/playlist rejects an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist',
      headers: authHeaders(),
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/playlist/generate wires through to the real filter pipeline', async () => {
    const video = await createMusicVideo(artistId, { title: 'Matched', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(video.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist/generate',
      headers: authHeaders(),
      payload: { name: 'Generated', filters: { yearMin: 1990 }, matchMode: 'all' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ matchedCount: 1 });
  });

  it('creates a smart playlist and prevents manual edits to rule-owned items', async () => {
    const video = await createMusicVideo(artistId, { title: 'Rule Match', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(video.id);
    const created = await app.inject({
      method: 'POST', url: '/api/v1/playlist/generate', headers: authHeaders(),
      payload: { name: 'Smart', filters: { yearMin: 1990 }, matchMode: 'all', smart: true, regenerateIntervalMinutes: 1440 },
    });
    expect(created.statusCode).toBe(200);
    const playlistId = created.json().playlistId;
    const remove = await app.inject({ method: 'DELETE', url: `/api/v1/playlist/${playlistId}/items/${video.id}`, headers: authHeaders() });
    const regenerate = await app.inject({ method: 'POST', url: `/api/v1/playlist/${playlistId}/regenerate`, headers: authHeaders() });
    const listed = await app.inject({ method: 'GET', url: '/api/v1/playlist', headers: authHeaders() });

    expect(remove.statusCode).toBe(409);
    expect(regenerate.statusCode).toBe(200);
    expect(listed.json()[0]).toMatchObject({ kind: 'smart', ruleMatchMode: 'all', regenerateIntervalMinutes: 1440 });
  });

  it('republishes a previously pushed smart playlist only when membership changes', async () => {
    const connector = await createLibraryConnector({ type: 'jellyfin' });
    await prisma.libraryConnector.update({ where: { id: connector.id }, data: { userId: 'user-1', videoLibraryId: 'videos-1' } });
    const first = await createMusicVideo(artistId, { title: 'First', hasFile: false, releaseYear: 2000 });
    await createLibraryVideo(connector.id, { musicVideoId: first.id, externalId: 'video-1', title: 'First' });
    const created = await app.inject({ method: 'POST', url: '/api/v1/playlist/generate', headers: authHeaders(),
      payload: { name: 'Smart publish', filters: { yearMin: 1990 }, matchMode: 'all', smart: true, targetConnectorId: connector.id } });
    const playlistId = created.json().playlistId;
    const requests: string[] = [];
    let nextId = 1;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, options: { method?: string }) => {
      requests.push(`${options.method ?? 'GET'} ${url}`);
      if (url.includes('/Users/') && url.includes('/Items?')) return { ok: true,
        json: async () => ({ Items: [
          { Id: 'video-1', Name: 'First', Artists: ['Test Artist'] },
          { Id: 'video-2', Name: 'Second', Artists: ['Test Artist'] },
        ] }) };
      if (url.endsWith('/Playlists') && options.method === 'POST') return { ok: true, status: 200,
        text: async () => JSON.stringify({ Id: `playlist-${nextId++}` }) };
      if (url.includes('/Items/playlist-') && options.method === 'DELETE') return { ok: true, status: 204, text: async () => '' };
      throw new Error(`Unexpected request: ${url}`);
    }));
    const firstPush = await app.inject({ method: 'POST', url: `/api/v1/playlist/${playlistId}/push/${connector.id}`, headers: authHeaders() });
    const unchanged = await app.inject({ method: 'POST', url: `/api/v1/playlist/${playlistId}/regenerate`, headers: authHeaders() });
    const second = await createMusicVideo(artistId, { title: 'Second', hasFile: false, releaseYear: 2001 });
    await createLibraryVideo(connector.id, { musicVideoId: second.id, externalId: 'video-2', title: 'Second' });
    const changed = await app.inject({ method: 'POST', url: `/api/v1/playlist/${playlistId}/regenerate`, headers: authHeaders() });
    const sync = await prisma.playlistSync.findUniqueOrThrow({ where: { playlistId_connectorId: { playlistId, connectorId: connector.id } } });
    const publishesAfterChange = requests.filter((request) => request.includes('POST') && request.endsWith('/Playlists')).length;
    await prisma.playlistSync.update({ where: { id: sync.id }, data: { lastPushStatus: 'failed' } });
    const retry = await app.inject({ method: 'POST', url: `/api/v1/playlist/${playlistId}/regenerate`, headers: authHeaders() });
    const retriedSync = await prisma.playlistSync.findUniqueOrThrow({ where: { id: sync.id } });
    expect(firstPush.statusCode).toBe(200);
    expect(unchanged.json().changed).toBe(false);
    expect(changed.json().changed).toBe(true);
    expect(publishesAfterChange).toBe(2);
    expect(retry.json().changed).toBe(false);
    expect(requests.filter((request) => request.includes('POST') && request.endsWith('/Playlists'))).toHaveLength(3);
    expect(requests.some((request) => request.includes('DELETE') && request.includes('/Items/playlist-1'))).toBe(true);
    expect(sync.remotePlaylistId).toBe('playlist-2');
    expect(retriedSync.remotePlaylistId).toBe('playlist-3');
  });

  it('POST /api/v1/playlist/generate rejects an invalid matchMode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist/generate',
      headers: authHeaders(),
      payload: { name: 'Bad', filters: {}, matchMode: 'xor' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists a confirmed server-only video as playable', async () => {
    const video = await createMusicVideo(artistId, { title: 'Server Only', hasFile: false });
    const connector = await createLibraryConnector();
    await createLibraryVideo(connector.id, { musicVideoId: video.id });

    const res = await app.inject({ method: 'GET', url: '/api/v1/musicvideo?playable=true', headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((item: { id: number }) => item.id)).toContain(video.id);
  });

  it('binds a static playlist to one playback connector for item selection and push', async () => {
    const target = await createLibraryConnector({ name: 'Target' });
    const other = await createLibraryConnector({ name: 'Other' });
    await prisma.libraryConnector.updateMany({ where: { id: { in: [target.id, other.id] } }, data: { videoLibraryId: 'videos' } });
    const targetVideo = await createMusicVideo(artistId, { title: 'Target Video', hasFile: false });
    await createLibraryVideo(target.id, { musicVideoId: targetVideo.id, externalId: 'target' });
    const otherVideo = await createMusicVideo(artistId, { title: 'Other Video', hasFile: false });
    await createLibraryVideo(other.id, { musicVideoId: otherVideo.id, externalId: 'other' });
    const created = await app.inject({ method: 'POST', url: '/api/v1/playlist', headers: authHeaders(),
      payload: { name: 'Bound', targetConnectorId: target.id } });
    const id = created.json().id;
    const eligible = await app.inject({ method: 'GET', url: `/api/v1/musicvideo?playableConnectorId=${target.id}`, headers: authHeaders() });
    const rejected = await app.inject({ method: 'POST', url: `/api/v1/playlist/${id}/items`, headers: authHeaders(),
      payload: { musicVideoId: otherVideo.id } });
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/playlist/${id}/items`, headers: authHeaders(),
      payload: { musicVideoId: targetVideo.id } });
    const wrongPush = await app.inject({ method: 'POST', url: `/api/v1/playlist/${id}/push/${other.id}`, headers: authHeaders() });

    expect(created.statusCode).toBe(201);
    expect(created.json().targetConnectorId).toBe(target.id);
    expect(eligible.json().map((item: { id: number }) => item.id)).toEqual([targetVideo.id]);
    expect(rejected.statusCode).toBe(409);
    expect(accepted.statusCode).toBe(201);
    expect(wrongPush.statusCode).toBe(409);
  });

  describe('playlist items', () => {
    let playlistId: number;
    let videoId: number;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/playlist',
        headers: authHeaders(),
        payload: { name: 'Items Playlist' },
      });
      playlistId = created.json().id;
      const video = await createMusicVideo(artistId, { title: 'Item Video', hasFile: true });
      videoId = video.id;
    });

    it('adds an item and lists it back in the playlist', async () => {
      const add = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      expect(add.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: '/api/v1/playlist', headers: authHeaders() });
      const playlist = list.json().find((p: { id: number }) => p.id === playlistId);
      expect(playlist.items).toHaveLength(1);
      expect(playlist.items[0].musicVideoId).toBe(videoId);
    });

    it('rejects adding the same video twice with 409', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      const dupe = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      expect(dupe.statusCode).toBe(409);
    });

    it('removes an item', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlistId}/items`,
        headers: authHeaders(),
        payload: { musicVideoId: videoId },
      });
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/playlist/${playlistId}/items/${videoId}`,
        headers: authHeaders(),
      });
      expect(del.statusCode).toBe(204);

      const list = await app.inject({ method: 'GET', url: '/api/v1/playlist', headers: authHeaders() });
      const playlist = list.json().find((p: { id: number }) => p.id === playlistId);
      expect(playlist.items).toHaveLength(0);
    });
  });

  describe('playlist push', () => {
    it('pushes a server-only video to its matching connector', async () => {
      const video = await createMusicVideo(artistId, { title: 'Server Only', hasFile: false });
      const connector = await createLibraryConnector({ type: 'jellyfin' });
      await prisma.libraryConnector.update({ where: { id: connector.id }, data: { userId: 'user-1', videoLibraryId: 'videos-1' } });
      await createLibraryVideo(connector.id, { musicVideoId: video.id, externalId: 'video-1', title: 'Server Only' });
      const playlist = await prisma.playlist.create({ data: { name: 'Server Playlist' } });
      await prisma.playlistItem.create({ data: { playlistId: playlist.id, musicVideoId: video.id, sortOrder: 0 } });
      const sentBodies: unknown[] = [];
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, options: { method?: string; body?: string }) => {
        if (url.includes('/Users/') && url.includes('/Items?')) return {
          ok: true, json: async () => ({ Items: [{ Id: 'video-1', Name: 'Server Only', Artists: ['Test Artist'] }] }),
        };
        if (url.endsWith('/Playlists') && options.method === 'POST') {
          sentBodies.push(JSON.parse(options.body ?? '{}'));
          return { ok: true, status: 200, text: async () => JSON.stringify({ Id: 'playlist-1' }) };
        }
        throw new Error(`Unexpected request: ${url}`);
      }));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${playlist.id}/push/${connector.id}`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().matchedCount).toBe(1);
      expect(sentBodies).toEqual([expect.objectContaining({ Ids: ['video-1'] })]);
    });

    it('404s when the playlist does not exist', async () => {
      const connector = await createLibraryConnector();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/999999/push/${connector.id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Playlist not found' });
    });

    it('404s when the connector does not exist', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/playlist',
        headers: authHeaders(),
        payload: { name: 'Push Target' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${created.json().id}/push/999999`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Connector not found' });
    });

    it('400s for a connector type that does not support playlist push (subsonic)', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/playlist',
        headers: authHeaders(),
        payload: { name: 'Push Target' },
      });
      const connector = await createLibraryConnector({ type: 'subsonic' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/playlist/${created.json().id}/push/${connector.id}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('does not support playlist push');
    });
  });

  it('DELETE /api/v1/playlist/:id removes the playlist', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/playlist',
      headers: authHeaders(),
      payload: { name: 'To Delete' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/playlist/${created.json().id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);
  });
});

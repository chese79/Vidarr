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

// A stand-in Jellyfin server: records every request, hands out playlist ids,
// answers per-item lookups (the "verify the reconciled id" step of a push), and
// can be told to fail deletes or report an item/playlist as already gone.
function stubJellyfin(options: { deleteStatus?: number; missingItems?: string[] } = {}) {
  const requests: string[] = [];
  const created: { Ids: string[]; Name: string }[] = [];
  let nextId = 1;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET';
    requests.push(`${method} ${url}`);
    const reply = (status: number, body?: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 404 ? 'Not Found' : status >= 500 ? 'Server Error' : 'OK',
      json: async () => body,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    });
    const itemLookup = url.match(/\/Users\/[^/]+\/Items\/([^/?]+)$/);
    if (itemLookup && method === 'GET') {
      return options.missingItems?.includes(itemLookup[1]) ? reply(404) : reply(200, { Id: itemLookup[1] });
    }
    if (url.endsWith('/Playlists') && method === 'POST') {
      created.push(JSON.parse(init.body ?? '{}'));
      return reply(200, { Id: `playlist-${nextId++}` });
    }
    if (url.includes('/Items/playlist-') && method === 'DELETE') {
      return options.deleteStatus ? reply(options.deleteStatus) : reply(204);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }));
  return { requests, created };
}

describe('playlist editing', () => {
  let app: FastifyInstance;
  let artistId: number;
  let connectorId: number;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: authHeaders(), payload: payload as object | undefined });

  // A published-capable Jellyfin connector.
  async function makeConnector(name: string) {
    const connector = await createLibraryConnector({ name, type: 'jellyfin' });
    await prisma.libraryConnector.update({ where: { id: connector.id }, data: { userId: 'user-1', videoLibraryId: 'videos-1' } });
    return connector.id;
  }

  // A video present on `connector` as a confirmed server match.
  async function serverVideo(title: string, onConnector: number, year = 2000) {
    const video = await createMusicVideo(artistId, { title, hasFile: false, releaseYear: year });
    await createLibraryVideo(onConnector, { musicVideoId: video.id, externalId: `ext-${title}`, title });
    return video;
  }

  async function createStatic(name: string, targetConnectorId?: number) {
    const res = await call('POST', '/playlist', { name, targetConnectorId });
    return res.json().id as number;
  }

  async function addItems(playlistId: number, ids: number[]) {
    for (const musicVideoId of ids) await call('POST', `/playlist/${playlistId}/items`, { musicVideoId });
  }

  const order = async (playlistId: number) =>
    (await call('GET', '/playlist')).json().find((p: { id: number }) => p.id === playlistId)
      .items.map((item: { musicVideoId: number }) => item.musicVideoId) as number[];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => app.close());
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    const rootFolder = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    artistId = (await createArtist(rootFolder.id, profile.id)).id;
    connectorId = await makeConnector('Jellyfin A');
  });

  describe('PATCH /playlist/:id', () => {
    it('renames a playlist and trims the name', async () => {
      const id = await createStatic('Old');
      const res = await call('PATCH', `/playlist/${id}`, { name: '  New name  ' });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('New name');
    });

    it('rejects an empty update, a blank name, and an unknown playlist', async () => {
      const id = await createStatic('Keep');
      expect((await call('PATCH', `/playlist/${id}`, {})).statusCode).toBe(400);
      expect((await call('PATCH', `/playlist/${id}`, { name: '   ' })).statusCode).toBe(400);
      expect((await call('PATCH', '/playlist/999999', { name: 'x' })).statusCode).toBe(404);
      expect((await call('GET', '/playlist')).json()[0].name).toBe('Keep');
    });

    it('refuses rule fields on a static playlist, whose contents are edited directly', async () => {
      const id = await createStatic('Manual');
      for (const body of [{ filters: { yearMin: 1990 } }, { matchMode: 'any' }, { sortMode: 'shuffle' }, { regenerateIntervalMinutes: 1440 }]) {
        const res = await call('PATCH', `/playlist/${id}`, body);
        expect(res.statusCode).toBe(400);
      }
    });

    describe('smart playlists', () => {
      async function createSmart() {
        const old = await createMusicVideo(artistId, { title: 'Old', hasFile: true, releaseYear: 1995 });
        await createMusicVideoFile(old.id);
        const recent = await createMusicVideo(artistId, { title: 'Recent', hasFile: true, releaseYear: 2005 });
        await createMusicVideoFile(recent.id, { path: '/media/recent.mp4' });
        const created = await call('POST', '/playlist/generate', {
          name: 'Smart', filters: { yearMin: 1990 }, matchMode: 'all', smart: true,
        });
        return { id: created.json().playlistId as number, old, recent };
      }

      it('re-runs the rules immediately when the filters change', async () => {
        const { id, recent } = await createSmart();
        expect(await order(id)).toHaveLength(2);

        const res = await call('PATCH', `/playlist/${id}`, { filters: { yearMin: 2000 } });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.json().ruleFilters)).toEqual({ yearMin: 2000 });
        expect(await order(id)).toEqual([recent.id]);
      });

      it('clearing all active filters includes the eligible library inventory', async () => {
        const { id } = await createSmart();
        for (const filters of [{}, { qualityIds: [] }]) {
          expect((await call('PATCH', `/playlist/${id}`, { filters })).statusCode).toBe(200);
        }
        expect(await order(id)).toHaveLength(2);
      });

      it('updates the schedule without touching membership', async () => {
        const { id } = await createSmart();
        const before = await order(id);
        const res = await call('PATCH', `/playlist/${id}`, { regenerateIntervalMinutes: 1440 });
        expect(res.json().regenerateIntervalMinutes).toBe(1440);
        expect((await call('PATCH', `/playlist/${id}`, { regenerateIntervalMinutes: null })).json().regenerateIntervalMinutes).toBeNull();
        expect(await order(id)).toEqual(before);
      });

      it('assigns a shuffle seed only when switching to shuffle, and keeps it on a no-op re-save', async () => {
        const { id } = await createSmart();
        const shuffled = (await call('PATCH', `/playlist/${id}`, { sortMode: 'shuffle' })).json();
        expect(shuffled.sortMode).toBe('shuffle');
        expect(shuffled.shuffleSeed).toEqual(expect.any(Number));

        const again = (await call('PATCH', `/playlist/${id}`, { sortMode: 'shuffle', name: 'Renamed' })).json();
        expect(again.shuffleSeed).toBe(shuffled.shuffleSeed);

        const back = (await call('PATCH', `/playlist/${id}`, { sortMode: 'artist_title' })).json();
        expect(back.sortMode).toBe('artist_title');
        expect(back.shuffleSeed).toBeNull();
      });

      it('republishes to a library it was already published to when an edit changes its videos', async () => {
        const first = await serverVideo('First', connectorId, 1995);
        const second = await serverVideo('Second', connectorId, 2005);
        const created = await call('POST', '/playlist/generate', {
          name: 'Published', filters: { yearMin: 1990 }, matchMode: 'all', smart: true, targetConnectorId: connectorId,
        });
        const id = created.json().playlistId as number;
        const server = stubJellyfin();
        expect((await call('POST', `/playlist/${id}/push/${connectorId}`)).statusCode).toBe(200);
        expect(server.created[0].Ids).toEqual(['ext-First', 'ext-Second']);

        const res = await call('PATCH', `/playlist/${id}`, { filters: { yearMin: 2000 } });

        expect(res.statusCode).toBe(200);
        expect(server.created).toHaveLength(2);
        expect(server.created[1].Ids).toEqual(['ext-Second']);
        expect(server.requests.some((r) => r.startsWith('DELETE') && r.endsWith('/Items/playlist-1'))).toBe(true);
        expect(first.id).not.toBe(second.id);
      });

      it('does not republish when an edit leaves the videos unchanged', async () => {
        await serverVideo('Only', connectorId, 2005);
        const created = await call('POST', '/playlist/generate', {
          name: 'Stable', filters: { yearMin: 1990 }, matchMode: 'all', smart: true, targetConnectorId: connectorId,
        });
        const id = created.json().playlistId as number;
        const server = stubJellyfin();
        await call('POST', `/playlist/${id}/push/${connectorId}`);

        await call('PATCH', `/playlist/${id}`, { filters: { yearMin: 1991 } });

        expect(server.created).toHaveLength(1);
      });
    });

    describe('changing the playback library', () => {
      it('accepts a library that has every video already in the playlist', async () => {
        const video = await serverVideo('Shared', connectorId);
        const id = await createStatic('Move me');
        await addItems(id, [video.id]);
        const other = await makeConnector('Jellyfin B');
        await createLibraryVideo(other, { musicVideoId: video.id, externalId: 'ext-b', title: 'Shared' });

        const res = await call('PATCH', `/playlist/${id}`, { targetConnectorId: other });

        expect(res.statusCode).toBe(200);
        expect(res.json().targetConnectorId).toBe(other);
      });

      it('refuses a library that is missing some of the playlist’s videos', async () => {
        const here = await serverVideo('Here', connectorId);
        const id = await createStatic('Bound', connectorId);
        await addItems(id, [here.id]);
        const other = await makeConnector('Jellyfin B');

        const res = await call('PATCH', `/playlist/${id}`, { targetConnectorId: other });

        expect(res.statusCode).toBe(409);
        expect(res.json().error).toContain('1 video(s)');
        expect((await call('GET', '/playlist')).json()[0].targetConnectorId).toBe(connectorId);
      });

      it('refuses a disabled connector or one with no video library selected', async () => {
        const id = await createStatic('Pick');
        const disabled = await makeConnector('Disabled');
        await prisma.libraryConnector.update({ where: { id: disabled }, data: { enabled: false } });
        const noLibrary = (await createLibraryConnector({ name: 'No library', type: 'jellyfin' })).id;
        const subsonic = (await createLibraryConnector({ name: 'Subsonic', type: 'subsonic' })).id;

        for (const target of [disabled, noLibrary, subsonic, 999999]) {
          expect((await call('PATCH', `/playlist/${id}`, { targetConnectorId: target })).statusCode).toBe(400);
        }
      });

      it('will not strand a published copy: the playlist must be removed from the old library first', async () => {
        const video = await serverVideo('Stuck', connectorId);
        const other = await makeConnector('Jellyfin B');
        await createLibraryVideo(other, { musicVideoId: video.id, externalId: 'ext-b', title: 'Stuck' });
        const id = await createStatic('Published', connectorId);
        await addItems(id, [video.id]);
        const server = stubJellyfin();
        await call('POST', `/playlist/${id}/push/${connectorId}`);

        const blocked = await call('PATCH', `/playlist/${id}`, { targetConnectorId: other });
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json().error).toContain('Jellyfin A');
        expect((await call('GET', '/playlist')).json()[0].targetConnectorId).toBe(connectorId);

        expect((await call('DELETE', `/playlist/${id}/push/${connectorId}`)).statusCode).toBe(204);
        expect((await call('PATCH', `/playlist/${id}`, { targetConnectorId: other })).statusCode).toBe(200);
        expect(server.requests.some((r) => r.startsWith('DELETE') && r.endsWith('/Items/playlist-1'))).toBe(true);
      });

      it('re-runs a smart playlist against the new library', async () => {
        const onA = await serverVideo('OnA', connectorId);
        const other = await makeConnector('Jellyfin B');
        const onB = await createMusicVideo(artistId, { title: 'OnB', hasFile: false, releaseYear: 2000 });
        await createLibraryVideo(other, { musicVideoId: onB.id, externalId: 'ext-OnB', title: 'OnB' });
        const created = await call('POST', '/playlist/generate', {
          name: 'Smart move', filters: { yearMin: 1990 }, matchMode: 'all', smart: true, targetConnectorId: connectorId,
        });
        const id = created.json().playlistId as number;
        expect(await order(id)).toEqual([onA.id]);

        await call('PATCH', `/playlist/${id}`, { targetConnectorId: other });

        expect(await order(id)).toEqual([onB.id]);
      });
    });
  });

  describe('PUT /playlist/:id/items/order', () => {
    async function threeItems() {
      const a = await serverVideo('A', connectorId);
      const b = await serverVideo('B', connectorId);
      const c = await serverVideo('C', connectorId);
      const id = await createStatic('Ordered', connectorId);
      await addItems(id, [a.id, b.id, c.id]);
      return { id, a: a.id, b: b.id, c: c.id };
    }

    it('rewrites the order and the new order is what gets pushed', async () => {
      const { id, a, b, c } = await threeItems();
      const res = await call('PUT', `/playlist/${id}/items/order`, { musicVideoIds: [c, a, b] });
      expect(res.statusCode).toBe(204);
      expect(await order(id)).toEqual([c, a, b]);

      const server = stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);
      expect(server.created[0].Ids).toEqual(['ext-C', 'ext-A', 'ext-B']);
    });

    it('rejects an order that is missing, adding, or repeating a video, leaving the order untouched', async () => {
      const { id, a, b, c } = await threeItems();
      const stranger = (await createMusicVideo(artistId, { title: 'Stranger' })).id;
      for (const musicVideoIds of [[a, b], [a, b, c, stranger], [a, a, b], [a, b, stranger]]) {
        expect((await call('PUT', `/playlist/${id}/items/order`, { musicVideoIds })).statusCode).toBe(409);
      }
      expect(await order(id)).toEqual([a, b, c]);
    });

    it('rejects a malformed body, an unknown playlist, and a smart playlist', async () => {
      const { id } = await threeItems();
      expect((await call('PUT', `/playlist/${id}/items/order`, { musicVideoIds: [] })).statusCode).toBe(400);
      expect((await call('PUT', `/playlist/${id}/items/order`, { musicVideoIds: ['x'] })).statusCode).toBe(400);
      expect((await call('PUT', '/playlist/999999/items/order', { musicVideoIds: [1] })).statusCode).toBe(404);

      const smart = await call('POST', '/playlist/generate', {
        name: 'Smart', filters: { yearMin: 1990 }, matchMode: 'all', smart: true,
      });
      const res = await call('PUT', `/playlist/${smart.json().playlistId}/items/order`, { musicVideoIds: [1] });
      expect(res.statusCode).toBe(409);
    });

    it('appends after a removal without colliding with an existing position', async () => {
      const { id, a, b, c } = await threeItems();
      await call('DELETE', `/playlist/${id}/items/${b}`);
      const d = (await serverVideo('D', connectorId)).id;
      await call('POST', `/playlist/${id}/items`, { musicVideoId: d });

      const sortOrders = (await prisma.playlistItem.findMany({ where: { playlistId: id } })).map((item) => item.sortOrder);
      expect(new Set(sortOrders).size).toBe(sortOrders.length);
      expect(await order(id)).toEqual([a, c, d]);
    });
  });

  describe('unpublishing and deleting', () => {
    async function publishedPlaylist() {
      const video = await serverVideo('Pub', connectorId);
      const id = await createStatic('Pub', connectorId);
      await addItems(id, [video.id]);
      return id;
    }
    const syncFor = (playlistId: number) =>
      prisma.playlistSync.findUnique({ where: { playlistId_connectorId: { playlistId, connectorId } } });

    it('removes the remote copy and the link but keeps the playlist', async () => {
      const id = await publishedPlaylist();
      const server = stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);

      const res = await call('DELETE', `/playlist/${id}/push/${connectorId}`);

      expect(res.statusCode).toBe(204);
      expect(server.requests).toContain(`DELETE ${(await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } })).host}/Items/playlist-1`);
      expect(await syncFor(id)).toBeNull();
      expect((await call('GET', '/playlist')).json()).toHaveLength(1);
    });

    it('treats a remote copy that is already gone as success', async () => {
      const id = await publishedPlaylist();
      stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);
      stubJellyfin({ deleteStatus: 404 });

      expect((await call('DELETE', `/playlist/${id}/push/${connectorId}`)).statusCode).toBe(204);
      expect(await syncFor(id)).toBeNull();
    });

    it('keeps the link when the remote delete fails, so it can be retried', async () => {
      const id = await publishedPlaylist();
      stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);
      stubJellyfin({ deleteStatus: 500 });

      const res = await call('DELETE', `/playlist/${id}/push/${connectorId}`);

      expect(res.statusCode).toBe(502);
      expect((await syncFor(id))?.remotePlaylistId).toBe('playlist-1');
    });

    it('404s when the playlist was never published to that library', async () => {
      const id = await publishedPlaylist();
      expect((await call('DELETE', `/playlist/${id}/push/${connectorId}`)).statusCode).toBe(404);
    });

    it('deleting a playlist also removes its published copies', async () => {
      const id = await publishedPlaylist();
      const server = stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);

      const res = await call('DELETE', `/playlist/${id}`);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ removedRemote: 1, failedRemote: [] });
      expect(server.requests.some((r) => r.startsWith('DELETE') && r.endsWith('/Items/playlist-1'))).toBe(true);
      expect(await prisma.playlist.count()).toBe(0);
    });

    it('still deletes locally when a remote copy cannot be removed, and says which one', async () => {
      const id = await publishedPlaylist();
      stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);
      stubJellyfin({ deleteStatus: 500 });

      const res = await call('DELETE', `/playlist/${id}`);

      expect(res.statusCode).toBe(200);
      expect(res.json().removedRemote).toBe(0);
      expect(res.json().failedRemote).toEqual([{ connectorName: 'Jellyfin A', error: expect.stringContaining('500') }]);
      expect(await prisma.playlist.count()).toBe(0);
    });

    it('leaves the published copies alone when asked to keep them', async () => {
      const id = await publishedPlaylist();
      stubJellyfin();
      await call('POST', `/playlist/${id}/push/${connectorId}`);
      const server = stubJellyfin();

      const res = await call('DELETE', `/playlist/${id}?keepRemote=true`);

      expect(res.json()).toEqual({ removedRemote: 0, failedRemote: [] });
      expect(server.requests).toEqual([]);
      expect(await prisma.playlist.count()).toBe(0);
    });

    it('404s when deleting a playlist that does not exist', async () => {
      expect((await call('DELETE', '/playlist/999999')).statusCode).toBe(404);
    });
  });

  describe('pushing', () => {
    it('verifies the reconciled id rather than searching by title', async () => {
      const video = await serverVideo('Exact', connectorId);
      const id = await createStatic('By id', connectorId);
      await addItems(id, [video.id]);
      const server = stubJellyfin();

      await call('POST', `/playlist/${id}/push/${connectorId}`);

      expect(server.created[0].Ids).toEqual(['ext-Exact']);
      expect(server.requests.some((r) => r.includes('SearchTerm='))).toBe(false);
    });

    it('refuses to push a playlist with nothing available, without contacting the server', async () => {
      const id = await createStatic('Empty', connectorId);
      const server = stubJellyfin();

      const res = await call('POST', `/playlist/${id}/push/${connectorId}`);

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toContain('no videos available');
      expect(server.requests).toEqual([]);
    });
  });
  it('replaces static contents from filters only when explicitly requested', async () => {
    const one = await serverVideo('One', connectorId);
    await serverVideo('Two', connectorId);
    const id = await createStatic('Snapshot', connectorId);
    await addItems(id, [one.id]);
    expect((await call('PATCH', `/playlist/${id}`, { maxVideos: 2, filters: {} })).statusCode).toBe(400);
    const result = await call('PATCH', `/playlist/${id}`, { replaceFromFilters: true, filters: {}, matchMode: 'all', maxVideos: 2, sortMode: 'shuffle' });
    expect(result.statusCode).toBe(200);
    expect(result.json().kind).toBe('static');
    expect(await order(id)).toHaveLength(2);
  });

});

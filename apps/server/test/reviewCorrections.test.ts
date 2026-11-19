import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile, createMusicVideo } from './support/db.js';
import { importDownloadedFile } from '../src/pipeline/import.js';
import { reconcileRecordingDelivery } from '../src/live/delivery.js';
import { getLibraryConnectorProvider } from '../src/providers/library/index.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import { qbittorrentProvider } from '../src/providers/downloadclient/qbittorrent.js';
import { pushPlaylist } from '../src/pipeline/playlistPush.js';
import { buildApp } from '../src/app.js';
import { TEST_API_KEY, authHeaders } from './support/http.js';
vi.mock('../src/providers/library/index.js', () => ({ getLibraryConnectorProvider: vi.fn() }));
let artistId: number, rootId: number, connectorId: number, temp: string;
beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-review-'));
    rootId = (await createRootFolder()).id;
    await prisma.rootFolder.update({ where: { id: rootId }, data: { path: path.join(temp, 'root') } });
    await fs.mkdir(path.join(temp, 'root'));
    artistId = (await createArtist(rootId, (await createQualityProfile((await createQuality()).id)).id)).id;
    connectorId = (await prisma.libraryConnector.create({ data: { name: 'Review fixture', type: 'jellyfin', host: 'http://fixture.invalid', userId: 'user', videoLibraryId: 'live' } })).id;
    vi.mocked(getLibraryConnectorProvider).mockReset().mockReturnValue({ fetchVideos: vi.fn().mockResolvedValue([]) } as any);
    await prisma.settings.update({ where: { id: 1 }, data: { namingFormat: '{Artist Name}/{Video Title}', transferMode: 'copy' } });
});
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(temp, { recursive: true, force: true }); });
it('rejects a symlinked import directory without writing outside its root', async () => {
    const outside = path.join(temp, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(temp, 'root', 'Test Artist'), 'dir');
    const video = await createMusicVideo(artistId);
    const source = path.join(temp, 'source.mp4');
    await fs.writeFile(source, 'review-fixture');
    await expect(importDownloadedFile(video.id, source, '1080p')).rejects.toThrow(/symlink/);
    expect(await fs.readdir(outside)).toEqual([]);
    expect(await fs.readFile(source, 'utf8')).toBe('review-fixture');
});
it('preserves another video bundle when a sanitized stem collides across extensions', async () => {
    const first = await createMusicVideo(artistId, { title: 'Foo:Bar' });
    const folder = path.join(temp, 'root', 'Test Artist');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'FooBar.mkv'), 'first-video');
    await fs.writeFile(path.join(folder, 'FooBar.nfo'), '<musicvideo><title>original metadata</title></musicvideo>');
    await prisma.musicVideoFile.create({ data: { musicVideoId: first.id, path: path.join(folder, 'FooBar.mkv'), sizeBytes: 11n, originalFilename: 'first.mkv' } });
    const second = await createMusicVideo(artistId, { title: 'FooBar' });
    const source = path.join(temp, 'second.mp4');
    await fs.writeFile(source, 'second-video');
    await expect(importDownloadedFile(second.id, source, '1080p')).rejects.toThrow(/stem/);
    expect(await fs.readFile(path.join(folder, 'FooBar.nfo'), 'utf8')).toContain('original metadata');
    expect(await fs.readFile(path.join(folder, 'FooBar.mkv'), 'utf8')).toBe('first-video');
});
it('does not replace a longer sibling video subtitle during a managed upgrade', async () => {
    const video = await createMusicVideo(artistId, { title: 'Song' });
    const sibling = await createMusicVideo(artistId, { title: 'Song.en' });
    const folder = path.join(temp, 'root', 'Test Artist'); await fs.mkdir(folder);
    for (const [id, name] of [[video.id, 'Song.mp4'], [sibling.id, 'Song.en.mkv']] as const) {
        const filename = path.join(folder, name); await fs.writeFile(filename, 'owned video');
        await prisma.musicVideoFile.create({ data: { musicVideoId: id, path: filename, originalFilename: name, sizeBytes: 11n } });
    }
    await fs.writeFile(path.join(folder, 'Song.en.srt'), 'sibling subtitle');
    const source = path.join(temp, 'upgrade.mp4'); await fs.writeFile(source, 'replacement');
    await fs.writeFile(path.join(temp, 'upgrade.en.srt'), 'new subtitle');
    await expect(importDownloadedFile(video.id, source, '1080p')).rejects.toThrow(/owns|ownership/);
    expect(await fs.readFile(path.join(folder, 'Song.mp4'), 'utf8')).toBe('owned video');
    expect(await fs.readFile(path.join(folder, 'Song.en.srt'), 'utf8')).toBe('sibling subtitle');
    expect(await fs.readFile(source, 'utf8')).toBe('replacement');
});
it.each(['queued', 'downloading', 'submissionUnknown', 'importing'])('artist deletion preserves %s reservations', async (status) => {
    const video = await createMusicVideo(artistId);
    const queue = await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, status, sourceType: 'indexer', sourceRef: 'external-job-still-running' } });
    const app = await buildApp();
    try {
        const response = await app.inject({ method: 'DELETE', url: `/api/v1/artist/${artistId}`, headers: authHeaders() });
        expect(response.statusCode).toBe(409);
        expect(await prisma.downloadQueueItem.findUnique({ where: { id: queue.id } })).not.toBeNull();
    }
    finally {
        await app.close();
    }
});
it('refreshes an available Live copy count independently of availability', async () => {
    await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ fullConnectorId: connectorId, fullLibraryId: 'live' }) } });
    const recording = await prisma.recording.create({ data: { title: 'Fixture', parts: { create: { position: 1, available: false, serverCopies: { create: { connectorId, libraryId: 'live', externalId: 'owned', expectedPath: '/server/owned.mp4', playCount: 0 } } } } }, include: { parts: { include: { serverCopies: true } } } });
    vi.mocked(getLibraryConnectorProvider).mockReturnValue({ fetchVideos: vi.fn().mockResolvedValue([{ externalId: 'owned', path: '/server/owned.mp4', playCount: 7 }]), listSections: vi.fn().mockResolvedValue([{ id: 'live' }]) } as any);
    await reconcileRecordingDelivery();
    expect((await prisma.recordingServerCopy.findUniqueOrThrow({ where: { id: recording.parts[0].serverCopies[0].id } })).playCount).toBe(7);
});
it('tracks a Base32 magnet using its hexadecimal qBittorrent identifier', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/auth/') ? new Response('Ok.', { headers: { 'set-cookie': 'SID=fixture' } }) : url.includes('/add') ? new Response('Ok.') : new Response(JSON.stringify(url.includes('hashes=' + '0'.repeat(40)) ? [{ state: 'uploading', progress: 1, content_path: '/fixture.mp4' }] : []))));
    const client = { host: 'fixture.invalid', port: 8080 } as any;
    const handle = await qbittorrentProvider.addDownload(client, 'magnet:?xt=urn:btih:' + 'A'.repeat(32), 'vidarr');
    expect(handle.externalRef).toBe('0'.repeat(40));
    expect((await qbittorrentProvider.getStatus(client, handle.externalRef, 'vidarr')).status).toBe('completed');
    expect((await qbittorrentProvider.getStatus(client, 'a'.repeat(32), 'vidarr')).status).toBe('completed');
});
it('syncs a video-only connector without requesting an audio library', async () => {
    const fetchArtists = vi.fn(jellyfinProvider.fetchArtists), fetchVideos = vi.fn().mockResolvedValue([]);
    vi.mocked(getLibraryConnectorProvider).mockReturnValue({ fetchArtists, fetchVideos } as any);
    const app = await buildApp();
    try {
        const result = await app.inject({ method: 'POST', url: `/api/v1/libraryconnector/${connectorId}/sync`, headers: authHeaders() });
        expect(result.statusCode).toBe(200);
        expect(fetchArtists).not.toHaveBeenCalled();
          const configured = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
          await expect(jellyfinProvider.fetchArtists(configured)).resolves.toEqual([]);
        expect(fetchVideos).toHaveBeenCalled();
    }
    finally {
        await app.close();
    }
});
it('serializes concurrent playlist creation and reuses its remote identity', async () => {
    const video = await createMusicVideo(artistId, { hasFile: true });
    const playlist = await prisma.playlist.create({ data: { name: 'Fixture', items: { create: { musicVideoId: video.id, sortOrder: 0 } } } });
    let count = 0;
    const push = vi.fn(async (_connector: any, input: any) => {
        const remotePlaylistId = input.existingRemoteId ?? 'remote-' + (++count);
        await new Promise(resolve => setTimeout(resolve, 10));
        return { remotePlaylistId, matchedCount: 1, unmatchedTitles: [] };
    });
    vi.mocked(getLibraryConnectorProvider).mockReturnValue({ pushPlaylist: push } as any);
    await Promise.all([pushPlaylist(playlist.id, connectorId), pushPlaylist(playlist.id, connectorId)]);
    expect(push).toHaveBeenCalledTimes(2);
    expect(count).toBe(1);
    expect(push.mock.calls[1][1].existingRemoteId).toBe('remote-1');
    expect(await prisma.playlistSync.count({ where: { playlistId: playlist.id } })).toBe(1);
});
it.each([['AC/DC', 'ac dc'], ['Beyoncé', 'beyonce']])('retains normalized inventory counts for %s', async (name, key) => {
    await prisma.artist.update({ where: { id: artistId }, data: { name, musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: '00000000-0000-4000-8000-000000000001' } });
    await prisma.libraryVideo.create({ data: { connectorId, externalId: 'unmatched', title: 'Uncataloged Song', normalizedTitle: 'uncataloged song', artistName: name, normalizedArtistName: key, available: true } });
    const app = await buildApp();
    try {
        const visible = await app.inject({ url: '/api/v1/artist/summary?hideWithoutVideos=false', headers: authHeaders() });
        expect(visible.statusCode).toBe(200);
        expect(visible.json().items[0].unmatchedVideoCount).toBe(1);
        const hidden = await app.inject({ url: '/api/v1/artist/summary?hideWithoutVideos=true', headers: authHeaders() });
        expect(hidden.json().items).toHaveLength(1);
    }
    finally {
        await app.close();
    }
});

import { normalizeTorrentHash } from '../src/providers/downloadclient/magnet.js';
it('decodes nonzero Base32 and preserves hexadecimal torrent identities', () => {
  expect(normalizeTorrentHash('7'.repeat(32))).toBe('f'.repeat(40));
  expect(normalizeTorrentHash('F'.repeat(40))).toBe('f'.repeat(40));
  expect(normalizeTorrentHash('invalid')).toBeNull();
});

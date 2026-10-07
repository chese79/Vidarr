import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import {
  resetDb, createRootFolder, createQuality, createQualityProfile, createArtist,
  createMusicVideo, createMusicVideoFile, createLibraryConnector,
} from './support/db.js';

const provider = vi.hoisted(() => ({ fetchVideos: vi.fn() }));
vi.mock('../src/providers/library/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/library/index.js')>()),
  getLibraryConnectorProvider: () => ({ testConnection: vi.fn(), fetchArtists: vi.fn(), fetchVideos: provider.fetchVideos }),
}));

import { generatePlaylistWithSync, regenerateSmartPlaylistWithSync, syncVideoConnectors } from '../src/pipeline/playlistSync.js';

const serverVideo = (title = 'Server Only', artistName = 'Test Artist') => ({
  externalId: `jf-${title}`, title, artistName, releaseYear: null, durationSeconds: null,
});

describe('on-demand video sync before playlist creation', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  async function connector(overrides: Partial<{ name: string; enabled: boolean; videoLibraryId: string | null }> = {}) {
    const created = await createLibraryConnector({ name: overrides.name ?? 'JF', enabled: overrides.enabled });
    return prisma.libraryConnector.update({
      where: { id: created.id },
      data: { videoLibraryId: overrides.videoLibraryId === undefined ? 'video-lib' : overrides.videoLibraryId },
    });
  }
  async function catalogVideo(title: string) {
    const artist = await prisma.artist.findFirst() ?? await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    return createMusicVideo(artist.id, { title });
  }

  beforeEach(async () => {
    await resetDb();
    provider.fetchVideos.mockReset().mockResolvedValue([]);
    rootFolderId = (await createRootFolder()).id;
    qualityProfileId = (await createQualityProfile((await createQuality()).id)).id;
  });

  it('re-reads the media server first, so a video only the server has can be in the playlist', async () => {
    const jf = await connector();
    const video = await catalogVideo('Server Only');
    provider.fetchVideos.mockResolvedValue([serverVideo('Server Only')]);

    expect(await prisma.libraryVideo.count()).toBe(0);
    const result = await generatePlaylistWithSync('Fresh', { musicVideoIds: [video.id] }, 'all', { targetConnectorId: jf.id });

    expect(result.matchedCount).toBe(1);
    expect(result.sync).toEqual([{ connectorId: jf.id, name: 'JF', status: 'synced', videoCount: 1 }]);
    const items = await prisma.playlistItem.findMany({ where: { playlistId: result.playlistId } });
    expect(items.map((i) => i.musicVideoId)).toEqual([video.id]);
  });

  it('syncs every time rather than trusting an earlier sync', async () => {
    await connector();
    const video = await catalogVideo('Server Only');
    provider.fetchVideos.mockResolvedValue([serverVideo('Server Only')]);
    await generatePlaylistWithSync('One', { musicVideoIds: [video.id] }, 'all');
    await generatePlaylistWithSync('Two', { musicVideoIds: [video.id] }, 'all');
    expect(provider.fetchVideos).toHaveBeenCalledTimes(2);
  });

  it('still creates the playlist from last known data when the sync fails, and says so', async () => {
    const jf = await connector();
    const video = await catalogVideo('Owned Locally');
    await prisma.musicVideo.update({ where: { id: video.id }, data: { hasFile: true } });
    provider.fetchVideos.mockRejectedValue(new Error('Jellyfin unreachable'));

    const result = await generatePlaylistWithSync('Offline', { musicVideoIds: [video.id] }, 'all');

    expect(result.matchedCount).toBe(1);
    expect(result.sync).toEqual([{ connectorId: jf.id, name: 'JF', status: 'failed', message: 'Jellyfin unreachable' }]);
    expect((await prisma.libraryConnector.findUniqueOrThrow({ where: { id: jf.id } })).syncRunning).toBe(false);
    expect(await prisma.activityLog.count({ where: { level: 'warn' } })).toBeGreaterThan(0);
  });

  it('a failed sync leaves previously synced videos available', async () => {
    const jf = await connector();
    const video = await catalogVideo('Known');
    await prisma.libraryVideo.create({ data: {
      connectorId: jf.id, externalId: 'old', title: 'Known', normalizedTitle: 'known', artistName: 'Test Artist',
      normalizedArtistName: 'test artist', available: true, musicVideoId: video.id, matchConfidence: null,
    } });
    provider.fetchVideos.mockRejectedValue(new Error('timeout'));

    const result = await generatePlaylistWithSync('Kept', { musicVideoIds: [video.id] }, 'all', { targetConnectorId: jf.id });
    expect(result.matchedCount).toBe(1);
    expect((await prisma.libraryVideo.findFirstOrThrow()).available).toBe(true);
  });

  it('does not start a second sync while one is already running', async () => {
    const jf = await connector();
    await prisma.libraryConnector.update({ where: { id: jf.id }, data: { syncRunning: true } });

    const reports = await syncVideoConnectors();
    expect(reports).toEqual([expect.objectContaining({ connectorId: jf.id, status: 'skipped' })]);
    expect(provider.fetchVideos).not.toHaveBeenCalled();
    // The running sync owns the flag; it must not be cleared out from under it.
    expect((await prisma.libraryConnector.findUniqueOrThrow({ where: { id: jf.id } })).syncRunning).toBe(true);
  });

  it('syncs only the target library when one is chosen, and never a disabled or video-less connector', async () => {
    const target = await connector({ name: 'Target' });
    await connector({ name: 'Other' });
    await connector({ name: 'Disabled', enabled: false });
    await connector({ name: 'NoVideoLibrary', videoLibraryId: null });

    expect((await syncVideoConnectors(target.id)).map((r) => r.name)).toEqual(['Target']);
    provider.fetchVideos.mockClear();
    expect((await syncVideoConnectors()).map((r) => r.name)).toEqual(['Target', 'Other']);
    expect(provider.fetchVideos).toHaveBeenCalledTimes(2);
  });

  it('reports nothing and builds normally when there is no connector to sync', async () => {
    const video = await catalogVideo('Local');
    await createMusicVideoFile(video.id);
    await prisma.musicVideo.update({ where: { id: video.id }, data: { hasFile: true } });
    const result = await generatePlaylistWithSync('Local only', { musicVideoIds: [video.id] }, 'all');
    expect(result).toMatchObject({ matchedCount: 1, sync: [] });
  });

  it('manually regenerating a smart playlist syncs first too', async () => {
    const jf = await connector();
    const video = await catalogVideo('Arrives Later');
    const created = await generatePlaylistWithSync('Smart', { musicVideoIds: [video.id] }, 'all', { smart: true, targetConnectorId: jf.id });
    expect(created.matchedCount).toBe(0);

    provider.fetchVideos.mockResolvedValue([serverVideo('Arrives Later')]);
    const result = await regenerateSmartPlaylistWithSync(created.playlistId);
    expect(result).toMatchObject({ matchedCount: 1, changed: true });
    expect(result.sync[0]).toMatchObject({ status: 'synced', videoCount: 1 });
  });
});

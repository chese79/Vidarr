import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { syncCachedFilePlayCounts } from '../src/pipeline/playCountSync.js';
import { syncLibraryConnector, syncAllLibraries } from '../src/pipeline/librarySync.js';
import { syncConnectorVideos } from '../src/pipeline/libraryVideoSync.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createMusicVideoFile, createLibraryConnector, createLibraryVideo } from './support/db.js';
vi.mock('../src/pipeline/recommendations.js', () => ({ refreshRecommendations: vi.fn(async () => ({ totalRecommendations: 0 })) }));
beforeEach(async () => { await resetDb(); await ensureSettings(); });
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const connector = await createLibraryConnector();
  await prisma.libraryConnector.update({ where: { id: connector.id }, data: { videoLibraryId: 'videos', userId: 'owner' } });
  const root = await createRootFolder(); await prisma.rootFolder.update({ where: { id: root.id }, data: { targetConnectorId: connector.id } });
  const artist = await createArtist(root.id, (await createQualityProfile((await createQuality()).id)).id);
  const video = await createMusicVideo(artist.id); const file = await createMusicVideoFile(video.id);
  const copy = await createLibraryVideo(connector.id, { musicVideoId: video.id, playCount: 0 });
  await prisma.libraryVideo.update({ where: { id: copy.id }, data: { libraryId: 'videos' } });
  return { connector: await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connector.id } }), root, video, file, copy };
}
it('imports a real zero into the file cache by confirmed server identity without HTTP', async () => {
  const f = await fixture(); const network = vi.spyOn(globalThis, 'fetch');
  expect(await syncCachedFilePlayCounts(f.connector.id)).toBe(1);
  expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { id: f.file.id } })).playCount).toBe(0);
  expect(await syncCachedFilePlayCounts(f.connector.id)).toBe(0); expect(network).not.toHaveBeenCalled();
});
it('does not turn unknown or uncertain native facts into a local file count', async () => {
  const f = await fixture();
  await prisma.libraryVideo.update({ where: { id: f.copy.id }, data: { playCount: null } });
  expect(await syncCachedFilePlayCounts(f.connector.id)).toBe(0);
  await prisma.libraryVideo.update({ where: { id: f.copy.id }, data: { playCount: 9, matchConfidence: 'probable' } });
  expect(await syncCachedFilePlayCounts(f.connector.id)).toBe(0);
  expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { id: f.file.id } })).playCount).toBeNull();
});
it('preserves a different primary connector and takes the maximum, never the sum, for unmapped roots', async () => {
  const f = await fixture(); const other = await createLibraryConnector({ name: 'Other' });
  await prisma.libraryConnector.update({ where: { id: other.id }, data: { videoLibraryId: 'other' } });
  const second = await createLibraryVideo(other.id, { musicVideoId: f.video.id, playCount: 3 });
  await prisma.libraryVideo.update({ where: { id: second.id }, data: { libraryId: 'other' } });
  await prisma.rootFolder.update({ where: { id: f.root.id }, data: { targetConnectorId: other.id } });
  expect(await syncCachedFilePlayCounts(f.connector.id)).toBe(0);
  await prisma.rootFolder.update({ where: { id: f.root.id }, data: { targetConnectorId: null } });
  await prisma.libraryVideo.update({ where: { id: f.copy.id }, data: { playCount: 2 } });
  await syncCachedFilePlayCounts(f.connector.id);
  expect((await prisma.musicVideoFile.findUniqueOrThrow({ where: { id: f.file.id } })).playCount).toBe(3);
});
it('releases the video-snapshot exclusion flag when a provider fails and keeps prior availability', async () => {
  const f = await fixture(); vi.spyOn(jellyfinProvider, 'fetchVideos').mockRejectedValue(Error('Video service unavailable'));
  await expect(syncConnectorVideos(f.connector)).rejects.toThrow('unavailable');
  expect((await prisma.libraryConnector.findUniqueOrThrow({ where: { id: f.connector.id } })).videoSyncRunning).toBe(false);
  expect((await prisma.libraryVideo.findUniqueOrThrow({ where: { id: f.copy.id } })).available).toBe(true);
});
it('supports a video-only connector without an unselected audio-library call', async () => {
  const f = await fixture(); const audio = vi.spyOn(jellyfinProvider, 'fetchArtists');
  vi.spyOn(jellyfinProvider, 'fetchVideos').mockResolvedValue([]);
  expect(await syncLibraryConnector(f.connector.id)).toMatchObject({ ok: true, artistCount: 0, videoCount: 0 });
  expect(audio).not.toHaveBeenCalled();
});
it('does not start a duplicate full sync or change another caller progress', async () => {
  const f = await fixture(); await prisma.libraryConnector.update({ where: { id: f.connector.id }, data: { syncRunning: true, syncProcessed: 7, syncTotal: 20 } });
  const audio = vi.spyOn(jellyfinProvider, 'fetchArtists');
  await expect(syncLibraryConnector(f.connector.id)).rejects.toMatchObject({ status: 409 });
  expect(audio).not.toHaveBeenCalled();
  expect(await prisma.libraryConnector.findUniqueOrThrow({ where: { id: f.connector.id } })).toMatchObject({ syncRunning: true, syncProcessed: 7, syncTotal: 20 });
});
it('continues scheduled syncs after one failure and ignores disabled/busy connectors', async () => {
  const busy = await createLibraryConnector({ name: 'Busy' });
  await prisma.libraryConnector.update({ where: { id: busy.id }, data: { musicLibraryId: 'music', syncRunning: true } });
  await createLibraryConnector({ name: 'Disabled', enabled: false });
  const broken = await createLibraryConnector({ name: 'Broken' }); const good = await createLibraryConnector({ name: 'Good' });
  await prisma.libraryConnector.updateMany({ where: { id: { in: [broken.id, good.id] } }, data: { musicLibraryId: 'music' } });
  const audio = vi.spyOn(jellyfinProvider, 'fetchArtists').mockImplementation(async config => { if (config.id === broken.id) throw Error('Offline'); return []; });
  await expect(syncAllLibraries()).rejects.toThrow('1 libraries synced, 1 already running, 1 failed');
  expect(audio).toHaveBeenCalledTimes(2);
  expect((await prisma.libraryConnector.findUniqueOrThrow({ where: { id: good.id } })).lastSyncStatus).toBe('success');
  expect((await prisma.libraryConnector.findUniqueOrThrow({ where: { id: broken.id } })).lastSyncStatus).toBe('failed');
});

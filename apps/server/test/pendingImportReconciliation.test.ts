import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { reconcilePendingImports } from '../src/pipeline/pendingImportReconciliation.js';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import { createArtist, createLibraryConnector, createMusicVideo, createMusicVideoFile, createQuality, createQualityProfile, createRootFolder, resetDb } from './support/db.js';

describe('pending import reconciliation', () => {
  let connectorId: number;
  let videoId: number;

  beforeEach(async () => {
    await resetDb();
    const connector = await createLibraryConnector();
    connectorId = connector.id;
    await prisma.libraryConnector.update({ where: { id: connectorId }, data: { videoLibraryId: 'videos' } });
    const root = await createRootFolder();
    await prisma.rootFolder.update({ where: { id: root.id }, data: { targetConnectorId: connectorId } });
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    const video = await createMusicVideo(artist.id, { title: 'New Video', hasFile: true });
    videoId = video.id;
    await createMusicVideoFile(videoId, { path: `${root.path}/Test Artist/new.mp4` });
    await prisma.musicVideo.update({ where: { id: videoId }, data: { awaitingServerScanAt: new Date() } });
    vi.spyOn(jellyfinProvider, 'refreshVideoLibrary').mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps an import pending through an empty scan, then confirms one exact server match', async () => {
    vi.spyOn(jellyfinProvider, 'fetchVideos').mockResolvedValueOnce([]).mockResolvedValueOnce([
      { externalId: 'server-video', title: 'New Video', artistName: 'Test Artist', path: 'D:\\MusicVideos\\Test Artist\\new.mp4' },
    ]);
    expect(await reconcilePendingImports()).toEqual({ checked: 1, confirmed: 0 });
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).awaitingServerScanAt).not.toBeNull();

    expect(await reconcilePendingImports()).toEqual({ checked: 1, confirmed: 1 });
    const inventory = await prisma.libraryVideo.findUniqueOrThrow({
      where: { connectorId_externalId: { connectorId, externalId: 'server-video' } },
    });
    expect(inventory).toMatchObject({ musicVideoId: videoId, available: true, matchConfidence: null });
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).awaitingServerScanAt).toBeNull();
  });

  it('retries a failed refresh and still checks for catalog confirmation', async () => {
    vi.mocked(jellyfinProvider.refreshVideoLibrary!).mockRejectedValueOnce(new Error('server busy'));
    vi.spyOn(jellyfinProvider, 'fetchVideos').mockResolvedValueOnce([]).mockResolvedValueOnce([
      { externalId: 'server-video', title: 'New Video', artistName: 'Test Artist', path: '/server/Test Artist/new.mp4' },
    ]);
    expect((await reconcilePendingImports()).confirmed).toBe(0);
    expect((await reconcilePendingImports()).confirmed).toBe(1);
    expect(jellyfinProvider.refreshVideoLibrary).toHaveBeenCalledTimes(2);
  });

  it('does not confirm ambiguous or previously rejected server matches', async () => {
    vi.spyOn(jellyfinProvider, 'fetchVideos').mockResolvedValueOnce([
      { externalId: 'one', title: 'New Video', artistName: 'Test Artist', path: '/server/Test Artist/new.mp4' },
      { externalId: 'two', title: 'New Video', artistName: 'Test Artist', path: '/server/Test Artist/new.mp4' },
    ]).mockResolvedValueOnce([{ externalId: 'one', title: 'New Video', artistName: 'Test Artist', path: '/server/Test Artist/new.mp4' }]);
    expect((await reconcilePendingImports()).confirmed).toBe(0);
    await prisma.libraryVideo.create({ data: { connectorId, externalId: 'one', title: 'New Video',
      normalizedTitle: 'new video', artistName: 'Test Artist', normalizedArtistName: 'test artist',
      rejectedMusicVideoId: videoId } });
    expect((await reconcilePendingImports()).confirmed).toBe(0);
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).awaitingServerScanAt).not.toBeNull();
  });

  it('does not complete delivery from an older server copy at another path', async () => {
    vi.spyOn(jellyfinProvider, 'fetchVideos').mockResolvedValue([
      { externalId: 'old-copy', title: 'New Video', artistName: 'Test Artist', path: '/server/old.mp4' },
    ]);
    expect((await reconcilePendingImports()).confirmed).toBe(0);
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).awaitingServerScanAt).not.toBeNull();
  });

  it('keeps an import pending when year or duration conflicts', async () => {
    await prisma.musicVideo.update({ where: { id: videoId }, data: { releaseYear: 2001, durationSeconds: 240 } });
    vi.spyOn(jellyfinProvider, 'fetchVideos').mockResolvedValueOnce([
      { externalId: 'wrong-year', title: 'New Video', artistName: 'Test Artist', path: '/server/Test Artist/new.mp4', releaseYear: 1999, durationSeconds: 240 },
    ]).mockResolvedValueOnce([
      { externalId: 'wrong-duration', title: 'New Video', artistName: 'Test Artist', path: '/server/Test Artist/new.mp4', releaseYear: 2001, durationSeconds: 300 },
    ]);
    expect((await reconcilePendingImports()).confirmed).toBe(0);
    expect((await reconcilePendingImports()).confirmed).toBe(0);
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: videoId } })).awaitingServerScanAt).not.toBeNull();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { grabYoutubeVideo, grabFromIndexer } from '../src/pipeline/grab.js';
import {
  resetDb,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
} from './support/db.js';

// grabFromIndexer's own dedup-race and orphan-prevention tests need to
// control what the external download client does (resolve fast, or throw)
// without actually contacting one, so the whole provider module is mocked —
// no DownloadClient/Indexer fixture helper exists in support/db.ts yet, so
// fixtures are created directly with prisma below.
vi.mock('../src/providers/downloadclient/index.js', () => ({
  getDownloadClientProvider: vi.fn(),
}));

async function createDownloadClient(overrides: Partial<{ name: string; implementation: string }> = {}) {
  return prisma.downloadClient.create({
    data: {
      name: overrides.name ?? 'Test Client',
      implementation: overrides.implementation ?? 'qBittorrent',
      host: 'localhost',
      port: 8080,
    },
  });
}

// Both grab functions check for an existing active DownloadQueueItem before
// doing anything else (before touching the real download client / yt-dlp),
// so seeding one directly and asserting the rejection is enough to prove the
// guard — no provider mocking needed for this specific behavior.
describe('duplicate-queue-entry prevention', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('grabFromIndexer refuses a second grab while one is already downloading', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id);
    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'indexer', sourceRef: 'existing', status: 'downloading' },
    });

    await expect(
      grabFromIndexer(video.id, 999999, 'http://example.test/release.torrent', '1080p'),
    ).rejects.toThrow('already has an active download');

    const items = await prisma.downloadQueueItem.findMany({ where: { musicVideoId: video.id } });
    expect(items).toHaveLength(1);
  });

  it('grabFromIndexer allows a grab when the only prior attempt failed', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id);
    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'indexer', sourceRef: 'old-failed', status: 'failed' },
    });

    // No real download client exists for id 999999, so this still throws —
    // but with the download-client lookup error, not the dedup guard,
    // proving the guard itself did not block it.
    await expect(
      grabFromIndexer(video.id, 999999, 'http://example.test/release.torrent', '1080p'),
    ).rejects.not.toThrow('already has an active download');
  });

  it('grabYoutubeVideo refuses a second grab while one is already downloading', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id, { youtubeVideoId: 'abc123' });
    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'abc123', status: 'downloading' },
    });

    await expect(grabYoutubeVideo(video.id)).rejects.toThrow('already has an active download');

    const items = await prisma.downloadQueueItem.findMany({ where: { musicVideoId: video.id } });
    expect(items).toHaveLength(1);
  });
});

// The hasActiveDownload() check-then-create in grab.ts is inherently racy on
// its own (two calls can both pass the check before either insert lands) —
// that's what migration 20260921045136_grab_queue_dedup_unique_index's
// partial unique index on DownloadQueueItem(musicVideoId) WHERE status IN
// ('queued','downloading') actually closes. These tests fire genuinely
// concurrent grabFromIndexer calls (via Promise.allSettled, not sequential
// awaits) so the race window is real, not simulated.
describe('grabFromIndexer — concurrent-grab dedup race', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('creates exactly one DownloadQueueItem row when two concurrent grabs race for the same video', async () => {
    const { getDownloadClientProvider } = await import('../src/providers/downloadclient/index.js');
    vi.mocked(getDownloadClientProvider).mockReturnValue({
      testConnection: vi.fn(),
      addDownload: vi.fn().mockResolvedValue({ externalRef: 'ext-ref' }),
      getStatus: vi.fn(),
    });

    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id);
    const client = await createDownloadClient();

    const results = await Promise.allSettled([
      grabFromIndexer(video.id, client.id, 'http://example.test/a.torrent', '1080p'),
      grabFromIndexer(video.id, client.id, 'http://example.test/b.torrent', '1080p'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser must fail with the same "already has an active download"
    // message the fast-path check itself produces — regardless of whether
    // it was actually caught by that check or by the unique index underneath
    // it, a caller must never see a raw Prisma P2002 error instead.
    expect((rejected[0].reason as Error).message).toBe('This video already has an active download.');

    const items = await prisma.downloadQueueItem.findMany({ where: { musicVideoId: video.id } });
    expect(items).toHaveLength(1);
  });

  it('deletes the queue row it just created, with no orphan left behind, when the download client rejects the download', async () => {
    const { getDownloadClientProvider } = await import('../src/providers/downloadclient/index.js');
    vi.mocked(getDownloadClientProvider).mockReturnValue({
      testConnection: vi.fn(),
      addDownload: vi.fn().mockRejectedValue(new Error('download client refused the job')),
      getStatus: vi.fn(),
    });

    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id);
    const client = await createDownloadClient();

    await expect(
      grabFromIndexer(video.id, client.id, 'http://example.test/release.torrent', '1080p'),
    ).rejects.toThrow('download client refused the job');

    // The row was necessarily created before addDownload() was ever called
    // (that ordering is the whole point of the fix — see grab.ts) — this
    // asserts none of it survives the failure: no locally-unrecorded state
    // AND no dangling "downloading" row either.
    const items = await prisma.downloadQueueItem.findMany({ where: { musicVideoId: video.id } });
    expect(items).toHaveLength(0);
    const history = await prisma.history.findMany({ where: { musicVideoId: video.id } });
    expect(history).toHaveLength(0);
  });
});

// Exercises the partial unique index migration itself, independent of any
// application-level guard or race timing — proves the index is really what
// stops a second live row, not just that grab.ts happens to behave.
describe('DownloadQueueItem partial unique index (migration 20260921045136_grab_queue_dedup_unique_index)', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
    await resetDb();
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('rejects a second row for the same musicVideoId while one is queued/downloading', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id);

    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'indexer', sourceRef: 'first', status: 'downloading' },
    });

    await expect(
      prisma.downloadQueueItem.create({
        data: { musicVideoId: video.id, sourceType: 'indexer', sourceRef: 'second', status: 'queued' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const items = await prisma.downloadQueueItem.findMany({ where: { musicVideoId: video.id } });
    expect(items).toHaveLength(1);
  });

  it('allows a new row once every prior row for that video is failed (the index only covers queued/downloading)', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id);

    await prisma.downloadQueueItem.create({
      data: { musicVideoId: video.id, sourceType: 'indexer', sourceRef: 'old', status: 'failed' },
    });

    await expect(
      prisma.downloadQueueItem.create({
        data: { musicVideoId: video.id, sourceType: 'indexer', sourceRef: 'retry', status: 'queued' },
      }),
    ).resolves.toBeDefined();

    const items = await prisma.downloadQueueItem.findMany({ where: { musicVideoId: video.id } });
    expect(items).toHaveLength(2);
  });

  it('still allows one queued/downloading row per video when the rows belong to different videos', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const videoA = await createMusicVideo(artist.id, { title: 'Video A', normalizedTitle: 'video a' });
    const videoB = await createMusicVideo(artist.id, { title: 'Video B', normalizedTitle: 'video b' });

    await expect(
      prisma.downloadQueueItem.create({
        data: { musicVideoId: videoA.id, sourceType: 'indexer', sourceRef: 'a', status: 'downloading' },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.downloadQueueItem.create({
        data: { musicVideoId: videoB.id, sourceType: 'indexer', sourceRef: 'b', status: 'downloading' },
      }),
    ).resolves.toBeDefined();
  });
});

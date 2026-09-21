import { describe, it, expect, beforeEach } from 'vitest';
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

// Both grab functions check for an existing active DownloadQueueItem before
// doing anything else (before touching the real download client / yt-dlp),
// so seeding one directly and asserting the rejection is enough to prove the
// guard — no provider mocking needed for this specific behavior.
describe('duplicate-queue-entry prevention', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
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

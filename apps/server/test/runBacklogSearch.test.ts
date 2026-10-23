import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/db/client.js';
import { previewBacklogSearch, runBacklogSearch } from '../src/pipeline/autoSearch.js';
import {
  resetDb,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
  createLibraryConnector,
  createLibraryVideo,
} from './support/db.js';

// runBacklogSearch's `wanted` query decides which videos are even attempted.
// Every seeded video here has an empty quality profile (no QualityProfileItem
// rows), so autoSearchAndGrab deterministically returns grabbed:false,
// reason:'Quality profile allows no qualities' for anything the query
// includes — no need to mock youtubeMatch/grab/indexer modules at all. This
// isolates the test to exactly what's being verified: the `wanted` query's
// exclusion filter, not the acquisition pipeline downstream of it.
describe('runBacklogSearch — library-match exclusion filter', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
    await resetDb();
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('previews without searching and never expands the approved set after eligibility changes', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const first = await createMusicVideo(artist.id, { title: 'Approved' });
    const removed = await createMusicVideo(artist.id, { title: 'Now owned' });
    await createMusicVideo(artist.id, { title: 'Ignored', ignored: true });
    const preview = await previewBacklogSearch();
    expect(preview.searches).toBe(2);
    expect(preview.videoIds.sort()).toEqual([first.id, removed.id].sort());
    expect(await prisma.downloadQueueItem.count()).toBe(0);
    await prisma.musicVideo.update({ where: { id: removed.id }, data: { hasFile: true } });
    await createMusicVideo(artist.id, { title: 'Added after preview' });
    expect(await runBacklogSearch(preview.videoIds)).toEqual({ grabbed: 0, skipped: 1 });
    expect(await runBacklogSearch([])).toEqual({ grabbed: 0, skipped: 0 });
  });

  it('still attempts a video whose only library match is an unconfirmed probable/ambiguous suggestion', async () => {
    // Regression for: a fuzzy reconciliation match (Phase 2b) must not
    // silently suppress backlog search until a human confirms it.
    const connector = await createLibraryConnector({ enabled: true });
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Probable Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Probable Video' });
    await createLibraryVideo(connector.id, {
      externalId: 'probable-1',
      musicVideoId: video.id,
      available: true,
      matchConfidence: 'probable',
    });

    const { skipped, grabbed } = await runBacklogSearch();
    expect(grabbed).toBe(0);
    expect(skipped).toBe(1);
  });

  it('does not attempt a video with a confirmed (matchConfidence: null), available, enabled-connector match', async () => {
    const connector = await createLibraryConnector({ enabled: true });
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Confirmed Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Confirmed Video' });
    await createLibraryVideo(connector.id, {
      externalId: 'confirmed-1',
      musicVideoId: video.id,
      available: true,
      matchConfidence: null,
    });

    const { skipped, grabbed } = await runBacklogSearch();
    expect(grabbed).toBe(0);
    expect(skipped).toBe(0);
  });

  it('still attempts a video whose only confirmed match belongs to a disabled connector', async () => {
    // Regression for: disabling a connector must not leave its stale
    // last-synced rows permanently counting as owned.
    const connector = await createLibraryConnector({ enabled: false });
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Disabled Connector Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Disabled Connector Video' });
    await createLibraryVideo(connector.id, {
      externalId: 'disabled-1',
      musicVideoId: video.id,
      available: true,
      matchConfidence: null,
    });

    const { skipped, grabbed } = await runBacklogSearch();
    expect(grabbed).toBe(0);
    expect(skipped).toBe(1);
  });

  it('attempts a plain missing video with no library match at all', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Missing Artist' });
    await createMusicVideo(artist.id, { title: 'Missing Video' });

    const { skipped, grabbed } = await runBacklogSearch();
    expect(grabbed).toBe(0);
    expect(skipped).toBe(1);
  });

  it('does not re-search a video while its imported file is awaiting the media-server scan', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Scanning Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Scanning Video' });
    await prisma.musicVideo.update({ where: { id: video.id }, data: { awaitingServerScanAt: new Date() } });

    const { skipped, grabbed } = await runBacklogSearch();
    expect(grabbed).toBe(0);
    expect(skipped).toBe(0);
  });
});

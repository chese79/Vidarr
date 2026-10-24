import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from './support/db.js';
import { getMusicBrainzLiveReferences, getMusicBrainzLiveEventReferences } from '../src/providers/metadata/musicbrainz.js';
import { discoverYoutubeChannel } from '../src/providers/youtube/musicDiscovery.js';
import { prepareLiveStartingInventory, saveLiveUpload, openLiveStartingItem, liveStartingItems, isLiveUpload, backfillLiveStartingInventories } from '../src/live/startingInventory.js';
import { syncYoutubeSource } from '../src/pipeline/youtubeSync.js';
import { runLiveMetadataMonitoring } from '../src/live/metadataMonitoring.js';

vi.mock('../src/providers/metadata/musicbrainz.js', () => ({ getMusicBrainzLiveReferences: vi.fn(), getMusicBrainzLiveEventReferences: vi.fn() }));
vi.mock('../src/providers/youtube/musicDiscovery.js', () => ({ discoverYoutubeChannel: vi.fn() }));
let artistId: number;
const video = { youtubeVideoId: 'Ri7-vnrJD3k', title: 'Adele - Set Fire To The Rain (Live at The Royal Albert Hall)', sourcePublishedAt: new Date('2011-11-01'), officialEvidence: ['title:official'], discoveryOrigins: ['youtube-music:playlist:official'] };
beforeEach(async () => {
  await resetDb(); await ensureSettings();
  artistId = (await createArtist((await createRootFolder()).id, (await createQualityProfile((await createQuality()).id)).id, { name: 'Adele' })).id;
  await prisma.artist.update({ where: { id: artistId }, data: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'cc2c9c3c-b7bc-4b8b-84d8-4fbd8779e493' } });
  vi.mocked(getMusicBrainzLiveReferences).mockReset().mockResolvedValue([{ id: 'royal', title: 'Live at the Royal Albert Hall', url: 'https://musicbrainz.org/release-group/royal', rank: 100, releaseDate: '2011-11-25', primaryType: 'Album' }]);
  vi.mocked(getMusicBrainzLiveEventReferences).mockReset().mockResolvedValue([]);
  vi.mocked(discoverYoutubeChannel).mockReset().mockResolvedValue({ videos: [video], errors: [] });
});
afterEach(() => { delete process.env.VIDARR_LIVE_COMPONENT; vi.unstubAllGlobals(); });

describe('artist Live starting inventory', () => {
  it('routes shared channel uploads into persistent Live discovery without admitting or downloading them', async () => {
    const source = await prisma.youtubeSource.create({ data: { artistId, type: 'channel', url: 'https://www.youtube.com/@Adele' } });
    await syncYoutubeSource(source.id);
    expect(await prisma.liveDiscoveryItem.findFirst()).toMatchObject({ artistId, kind: 'video', externalId: video.youtubeVideoId });
    expect(await prisma.videoReviewCandidate.findFirst()).toMatchObject({ decision: 'rejected' });
    expect(await prisma.livePerformance.count()).toBe(0);
    expect(await prisma.recording.count()).toBe(0);
    expect(await prisma.downloadQueueItem.count()).toBe(0);
  });
  it('does not mistake song titles or trailers/audio for performance videos', () => {
    for (const title of ['Live and Let Die (Official Video)', 'Adele Live at Royal Albert Hall (Trailer)', 'Hometown Glory (Live) (Official Audio)', 'Live backstage interview']) expect(isLiveUpload(title)).toBe(false);
    expect(isLiveUpload('Adele US TOUR: Right As Rain live @ Seattle')).toBe(true);
  });
  it('respects disablement and component absence without clearing existing discoveries', async () => {
    await saveLiveUpload(artistId, video, 'channel');
    await prisma.settings.update({ where: { id: 1 }, data: { liveEnabled: false } });
    await prepareLiveStartingInventory(artistId, true);
    expect(getMusicBrainzLiveReferences).not.toHaveBeenCalled();
    expect(await prisma.liveDiscoveryItem.count()).toBe(1);
    expect((await liveStartingItems(artistId, 'video')).enabled).toBe(false);
    await prisma.settings.update({ where: { id: 1 }, data: { liveEnabled: true } });
    process.env.VIDARR_LIVE_COMPONENT = 'disabled';
    expect(await backfillLiveStartingInventories()).toContain('disabled');
    await expect(openLiveStartingItem(artistId, (await prisma.liveDiscoveryItem.findFirstOrThrow()).id)).rejects.toThrow('disabled');
  });
  it('keeps five ranked references at a time instead of creating a missing-performance backlog', async () => {
    vi.mocked(getMusicBrainzLiveReferences).mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `Reference ${i}`, url: `https://musicbrainz.org/release-group/${i}`, rank: i, releaseDate: '2011-11-25', primaryType: 'Album' })));
    await prepareLiveStartingInventory(artistId);
    const page = await liveStartingItems(artistId, 'reference');
    expect(page.total).toBe(12); expect(page.items).toHaveLength(5);
    expect(page.items[0].title).toBe('Reference 11');
    expect(await prisma.livePerformance.count()).toBe(0);
    expect((await liveStartingItems(artistId, 'reference', 5)).items[0].title).toBe('Reference 6');
  });
  it('recovers only automatic live exclusions and preserves manual MV rejections', async () => {
    for (const [externalId, reason] of [['Ri7-vnrJD3k', 'Title indicates live/concert footage, not a song music video.'], ['HDpCv71r-0U', 'Rejected by user']]) await prisma.videoReviewCandidate.create({ data: { artistId, source: 'youtube', externalId, title: video.title, artistName: 'Adele', decision: 'rejected', reason } });
    await prepareLiveStartingInventory(artistId);
    expect(await prisma.liveDiscoveryItem.count({ where: { kind: 'video' } })).toBe(1);
    expect(await prisma.videoReviewCandidate.count({ where: { decision: 'rejected' } })).toBe(2);
  });
  it('preserves dismissals and partial results across repeat scans and provider failures', async () => {
    await prepareLiveStartingInventory(artistId);
    await prisma.liveDiscoveryItem.updateMany({ data: { dismissed: true } });
    await prepareLiveStartingInventory(artistId, true);
    expect((await liveStartingItems(artistId, 'reference')).items).toEqual([]);
    vi.mocked(getMusicBrainzLiveReferences).mockRejectedValue(new Error('provider unavailable'));
    await prepareLiveStartingInventory(artistId, true);
    expect(await prisma.liveDiscoveryItem.count()).toBe(1);
    expect(await prisma.artist.findUnique({ where: { id: artistId } })).toMatchObject({ liveDiscoveryStatus: 'partial', liveDiscoveryError: expect.stringContaining('unavailable') });
  });
  it('opens a video in normal pending review idempotently with unknown performance date/place', async () => {
    await saveLiveUpload(artistId, video, 'channel');
    const item = await prisma.liveDiscoveryItem.findFirstOrThrow();
    const first = await openLiveStartingItem(artistId, item.id), second = await openLiveStartingItem(artistId, item.id);
    expect(second).toEqual(first);
    expect(await prisma.recording.findUnique({ where: { id: first.recordingId } })).toMatchObject({ reviewStatus: 'pending', identityVerified: false, videoVerified: false });
    expect(await prisma.livePerformance.findUnique({ where: { id: first.performanceId! } })).toMatchObject({ performanceDate: null, venue: null });
    expect(await prisma.downloadQueueItem.count()).toBe(0);
  });
  it('does not convert a release date into a performance date or start a source search on opening a reference', async () => {
    await prepareLiveStartingInventory(artistId);
    const first = await openLiveStartingItem(artistId, (await prisma.liveDiscoveryItem.findFirstOrThrow()).id);
    expect(await prisma.livePerformance.findUnique({ where: { id: first.performanceId } })).toMatchObject({ performanceDate: null, identityStatus: 'reference' });
    expect(await prisma.recording.count()).toBe(0); expect(discoverYoutubeChannel).not.toHaveBeenCalled();
  });
  it('never calls setlist.fm on background preparation or existing metadata-monitoring jobs', async () => {
    await prisma.liveConfiguration.create({ data: { setlistApiKey: 'test-only-key' } });
    await prisma.liveMonitoringRule.create({ data: { artistId, filters: '{}' } });
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await prepareLiveStartingInventory(artistId); await runLiveMetadataMonitoring();
    expect(request).not.toHaveBeenCalled(); expect(await prisma.livePerformance.count()).toBe(0);
  });
  it('warms artists with saved Live uploads first so initial entry has useful starting points', async () => {
    const artist = await prisma.artist.update({ where: { id: artistId }, data: { addedAt: new Date('2020-01-01') } });
    for (let i = 1; i <= 4; i++) await prisma.artist.create({ data: { name: `New artist ${i}`, sortName: `New artist ${i}`, rootFolderId: artist.rootFolderId, qualityProfileId: artist.qualityProfileId,
      musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` } });
    await prisma.videoReviewCandidate.create({ data: { artistId, artistName: 'Adele', source: 'youtube', externalId: video.youtubeVideoId, title: video.title } });
    await backfillLiveStartingInventories();
    expect(await prisma.liveDiscoveryItem.count({ where: { artistId, kind: 'video' } })).toBe(1);
    expect(await prisma.artist.count({ where: { liveDiscoveryStatus: 'complete' } })).toBe(3);
    expect(await prisma.livePerformance.count()).toBe(0);
  });
});

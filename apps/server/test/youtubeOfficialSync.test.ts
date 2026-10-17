import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { createArtist, createQuality, createQualityProfile, createRootFolder, resetDb } from './support/db.js';
import { discoverYoutubeChannel, type DiscoveredYoutubeVideo } from '../src/providers/youtube/musicDiscovery.js';
import { getVideoMetadata } from '../src/providers/youtube/ytdlp.js';
import { resolveReview, classifyCandidate, excludedMusicVideoTitleReason } from '../src/pipeline/youtubeValidation.js';
import { syncYoutubeSource } from '../src/pipeline/youtubeSync.js';
import { officialSongIdentity } from '../src/pipeline/youtubeOfficial.js';
vi.mock('../src/providers/youtube/musicDiscovery.js', async original => ({ ...(await original<typeof import('../src/providers/youtube/musicDiscovery.js')>()), discoverYoutubeChannel: vi.fn() }));
vi.mock('../src/providers/youtube/ytdlp.js', async original => ({ ...(await original<typeof import('../src/providers/youtube/ytdlp.js')>()), getVideoMetadata: vi.fn() }));
vi.mock('../src/pipeline/youtubeValidation.js', async original => ({ ...(await original<typeof import('../src/pipeline/youtubeValidation.js')>()), resolveReview: vi.fn() }));
const item = (id = 'abcdefghijk', title = 'Band - Song (Video)', evidence = ['category:Official Music Videos']): DiscoveredYoutubeVideo => ({
  youtubeVideoId: id, title, sourcePublishedAt: null, officialEvidence: evidence, discoveryOrigins: ['youtube-music:playlist:PLofficial'],
});
describe('official YouTube canonical admission', () => {
  beforeEach(async () => {
    await resetDb(); vi.resetAllMocks();
    vi.mocked(discoverYoutubeChannel).mockResolvedValue({ videos: [item()], errors: [] });
    vi.mocked(getVideoMetadata).mockResolvedValue({ title: 'Band - Song (Video)', channel: 'BandVEVO', description: 'Music video by Band.', channelIsVerified: true });
    vi.mocked(resolveReview).mockResolvedValue({ decision: 'accept', reason: 'Sample clip shows real motion.' });
  });
  async function setup() {
    const root = await createRootFolder(); const profile = await createQualityProfile((await createQuality()).id);
    const artist = await createArtist(root.id, profile.id, { name: 'Band' });
    await prisma.artist.update({ where: { id: artist.id }, data: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    const source = await prisma.youtubeSource.create({ data: { artistId: artist.id, url: 'https://music.youtube.com/channel/UCband', type: 'channel' } });
    return { artist, source, root, profile };
  }
  it('automates category-only admission after metadata/identity and motion checks, preserving provenance and idempotence', async () => {
    const { artist, source } = await setup();
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 1, pending: 0 });
    const video = await prisma.musicVideo.findFirstOrThrow();
    expect(video).toMatchObject({ artistId: artist.id, title: 'Song', catalogKind: 'official', monitored: false, youtubeVideoId: 'abcdefghijk' });
    const accepted = await prisma.acquisitionSource.findFirstOrThrow();
    expect(accepted).toMatchObject({ authority: 'verified', confidence: 'confirmed', accepted: true });
    expect(JSON.parse(accepted.discoveryOrigin)).toMatchObject({ evidence: ['category:Official Music Videos'], origins: ['youtube-music:playlist:PLofficial'] });
    expect(await prisma.videoReviewCandidate.findFirst()).toMatchObject({ decision: 'approved', title: 'Song' });
    expect(await prisma.downloadQueueItem.count()).toBe(0);
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 0, matched: 1 });
    expect(getVideoMetadata).toHaveBeenCalledTimes(1);
    expect(resolveReview).toHaveBeenCalledTimes(1);
  });
  it('admits whole-word Official titles, without requiring the English Official Video phrase', async () => {
    const { source } = await setup();
    vi.mocked(discoverYoutubeChannel).mockResolvedValue({ videos: [item('abcdefghijk', 'Band - Song (Official)', ['title:official'])], errors: [] });
    vi.mocked(getVideoMetadata).mockResolvedValue({ title: 'Band - Song (Official)', channel: 'Label', description: '', channelIsVerified: false });
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 1 });
  });
  it('excludes deleted IDs before inspection and allows normal admission when exclusion is disabled', async () => {
    const { artist, source } = await setup();
    await prisma.deletedVideoRecord.create({ data: { originalMusicVideoId: 999999, artistId: artist.id, title: 'Song', identities: JSON.stringify(['youtube:abcdefghijk']) } });
    await prisma.settings.create({ data: { id: 1, excludeDeletedVideosFromScans: true } });
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 0, pending: 0 });
    expect(getVideoMetadata).not.toHaveBeenCalled();
    await prisma.settings.update({ where: { id: 1 }, data: { excludeDeletedVideosFromScans: false } });
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 1 });
  });
  it('rejects official audio, lyrics, live, concerts and visualizers even inside an official category', async () => {
    const { source } = await setup();
    const titles = ['Band - Song (Official Audio)', 'Band - Song (Official Lyric Video)', 'Band - Song (Live)', 'Band - Song (Official Concert Video)', 'Band - Song (Visualizer)', 'Band - Song - Live'];
    vi.mocked(discoverYoutubeChannel).mockResolvedValue({ videos: titles.map((t,i)=>item(`video00000${i}`,t)), errors: [] });
    await syncYoutubeSource(source.id);
    expect(await prisma.musicVideo.count()).toBe(0);
    expect(await prisma.videoReviewCandidate.count({ where: { decision: 'rejected' } })).toBe(titles.length);
    expect(resolveReview).not.toHaveBeenCalled();
    expect(getVideoMetadata).not.toHaveBeenCalled();
  });
  it('rejects an actual Topic publisher and previously streamed performance after metadata inspection', async () => {
    const { source } = await setup();
    vi.mocked(getVideoMetadata).mockResolvedValueOnce({ title: 'Band - Song', channel: 'Band - Topic', description: '', channelIsVerified: false });
    await syncYoutubeSource(source.id);
    expect(await prisma.videoReviewCandidate.findFirst()).toMatchObject({ decision: 'rejected' });
    expect(resolveReview).not.toHaveBeenCalled();
    expect(classifyCandidate({ title: 'Band - Song (Official Video)', channel: 'Band', description: '', channelIsVerified: true, isLivePerformance: true }).decision).toBe('reject');
  });
  it('keeps explicit wrong-artist credits pending without inspecting motion', async () => {
    const { source } = await setup();
    vi.mocked(discoverYoutubeChannel).mockResolvedValue({ videos: [item('abcdefghijk','Another Artist - Song (Official Video)')], errors: [] });
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 0, pending: 1 });
    expect(getVideoMetadata).not.toHaveBeenCalled();
    expect(await prisma.videoReviewCandidate.findFirst()).toMatchObject({ decision: 'pending', artistName: 'Another Artist' });
  });
  it('preserves shared-channel review ownership and manual rejections', async () => {
    const { source, root, profile } = await setup();
    const other = await createArtist(root.id, profile.id, { name: 'Other Artist' });
    const row = await prisma.videoReviewCandidate.create({ data: { source: 'youtube', externalId: 'abcdefghijk', title: 'Existing title', artistName: other.name, artistId: other.id, reason: 'Existing review' } });
    await syncYoutubeSource(source.id);
    expect(await prisma.videoReviewCandidate.findUnique({ where: { id: row.id } })).toMatchObject({ artistId: other.id, title: 'Existing title', reason: 'Existing review' });
    await prisma.videoReviewCandidate.update({ where: { id: row.id }, data: { decision: 'rejected' } });
    await syncYoutubeSource(source.id);
    expect(getVideoMetadata).not.toHaveBeenCalled();
    expect(await prisma.musicVideo.count()).toBe(0);
  });
  it('retains partial discoveries and leaves the success timestamp unchanged for retry', async () => {
    const { source } = await setup();
    vi.mocked(discoverYoutubeChannel).mockResolvedValue({ videos: [item('abcdefghijk','Band - Uncertain Song',[])], errors: ['Music continuation failed'] });
    await expect(syncYoutubeSource(source.id)).rejects.toThrow(/discovery incomplete/);
    expect(await prisma.videoReviewCandidate.count()).toBe(1);
    expect(await prisma.youtubeSource.findUnique({ where: { id: source.id } })).toMatchObject({ lastPolledAt: null });
    vi.mocked(discoverYoutubeChannel).mockResolvedValue({ videos: [item('abcdefghijk','Band - Uncertain Song',[])], errors: [] });
    await syncYoutubeSource(source.id);
    expect((await prisma.youtubeSource.findUniqueOrThrow({ where: { id: source.id } })).lastPolledAt).not.toBeNull();
  });
  it('keeps metadata failures reviewable and can admit after retry', async () => {
    const { source } = await setup();
    vi.mocked(getVideoMetadata).mockRejectedValueOnce(new Error('provider timeout'));
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 0, pending: 1 });
    expect(await syncYoutubeSource(source.id)).toMatchObject({ created: 1, pending: 0 });
  });
  it('does not admit static samples or overwrite an existing distinct video version', async () => {
    const { source, artist } = await setup();
    vi.mocked(resolveReview).mockResolvedValueOnce({ decision: 'reject', reason: 'Static sample' });
    await syncYoutubeSource(source.id);
    expect(await prisma.musicVideo.count()).toBe(0);
    await prisma.videoReviewCandidate.deleteMany();
    await prisma.musicVideo.create({ data: { artistId: artist.id, title: 'Song', normalizedTitle: 'song', youtubeVideoId: 'differentid', ignored: true } });
    await syncYoutubeSource(source.id);
    expect(await prisma.musicVideo.findMany({ orderBy: { id: 'asc' } })).toEqual([
      expect.objectContaining({ title: 'Song', youtubeVideoId: 'differentid', ignored: true }),
      expect.objectContaining({ title: 'Song (Version 2)', youtubeVideoId: 'abcdefghijk' }),
    ]);
  });
  it('requires exact artist credit or a matching actual uploader; preserves song names containing Live', () => {
    expect(officialSongIdentity('Other - Song (Official Video)', 'BandVEVO','Band')).toBeNull();
    expect(officialSongIdentity('Song (Video)', 'BandVEVO','Band')).toBe('Song');
    expect(officialSongIdentity('Song (Video)', 'Label','Band')).toBeNull();
    expect(officialSongIdentity('Другой - Song (Official Video)', 'Другой', 'Кино')).toBeNull();
    expect(excludedMusicVideoTitleReason('Oasis - Live Forever (Official Video)')).toBeNull();
    expect(excludedMusicVideoTitleReason('Band - Song (Live at a Festival)')).toMatch(/live/);
  });
  it('preserves a same-title IMVDb version and its owned file when the new source identity differs', async () => {
    const { source, artist } = await setup();
    const original = await prisma.musicVideo.create({ data: { artistId: artist.id, title: 'Song', normalizedTitle: 'song', imvdbVideoId: 'known-version', hasFile: true } });
    await prisma.musicVideoFile.create({ data: { musicVideoId: original.id, path: '/original/song.mp4', originalFilename: 'song.mp4', sizeBytes: 1n } });
    await syncYoutubeSource(source.id);
    expect(await prisma.musicVideo.findUnique({ where: { id: original.id }, include: { file: true } })).toMatchObject({
      title: 'Song', imvdbVideoId: 'known-version', youtubeVideoId: null, hasFile: true, file: { path: '/original/song.mp4' },
    });
    expect(await prisma.musicVideo.findFirst({ where: { youtubeVideoId: 'abcdefghijk' } })).toMatchObject({ title: 'Song (Version 2)', hasFile: false });
  });
  it('retains a known review publication date when Music listing dates are unknown', async () => {
    const { source, artist } = await setup();
    const publishedAt = new Date('1998-01-01T00:00:00Z');
    await prisma.videoReviewCandidate.create({ data: { source: 'youtube', externalId: 'abcdefghijk', title: 'Song', artistName: 'Band', artistId: artist.id, sourcePublishedAt: publishedAt } });
    await syncYoutubeSource(source.id);
    expect((await prisma.videoReviewCandidate.findFirstOrThrow()).sourcePublishedAt).toEqual(publishedAt);
    expect((await prisma.musicVideo.findFirstOrThrow()).sourcePublishedAt).toEqual(publishedAt);
  });
  it('does not let an inferred song title disable the fan-cover exclusion', async () => {
    const { source } = await setup();
    vi.mocked(getVideoMetadata).mockResolvedValue({ title: 'Band - Song (Cover by Someone) (Official Video)', channel: 'Someone', description: '', channelIsVerified: false });
    await syncYoutubeSource(source.id);
    expect(await prisma.musicVideo.count()).toBe(0);
    expect(await prisma.videoReviewCandidate.findFirst()).toMatchObject({ decision: 'rejected' });
    expect(resolveReview).not.toHaveBeenCalled();
  });
});

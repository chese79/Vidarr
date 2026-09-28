import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist } from './support/db.js';

vi.mock('../src/providers/youtube/ytdlp.js', () => ({
  listChannelVideos: vi.fn().mockResolvedValue([
    { youtubeVideoId: 'song-video', title: '311 - Down (Official Music Video)', sourcePublishedAt: new Date('1995-01-01T00:00:00Z') },
    { youtubeVideoId: 'interview', title: '311 Official Interview', sourcePublishedAt: null },
  ]),
}));

describe('YouTube channel discovery', () => {
  beforeEach(async () => { await resetDb(); });

  it('holds song uploads for review and excludes interviews without creating catalog videos', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id, { name: '311' });
    await prisma.artist.update({ where: { id: artist.id }, data: {
      musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    } });
    const source = await prisma.youtubeSource.create({ data: {
      artistId: artist.id, type: 'channel', url: 'https://www.youtube.com/@311', monitored: true,
    } });

    const { pollAndGrabYoutubeSource } = await import('../src/pipeline/youtubeSync.js');
    const result = await pollAndGrabYoutubeSource(source.id);

    expect(result).toMatchObject({ created: 0, pending: 1, grabbed: 0 });
    expect(await prisma.musicVideo.count()).toBe(0);
    expect(await prisma.videoReviewCandidate.findMany({ orderBy: { externalId: 'asc' } }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ externalId: 'song-video', decision: 'pending', artistId: artist.id }),
        expect.objectContaining({ externalId: 'interview', decision: 'rejected' }),
      ]));

    const songBefore = await prisma.videoReviewCandidate.findUniqueOrThrow({ where: {
      source_externalId: { source: 'youtube', externalId: 'song-video' },
    } });
    expect(songBefore.sourcePublishedAt?.toISOString()).toBe('1995-01-01T00:00:00.000Z');
    expect(songBefore.firstSeenAt).toBeInstanceOf(Date);
    expect(songBefore.lastSeenAt).toBeInstanceOf(Date);
    await pollAndGrabYoutubeSource(source.id);
    const songAfter = await prisma.videoReviewCandidate.findUniqueOrThrow({ where: {
      source_externalId: { source: 'youtube', externalId: 'song-video' },
    } });
    expect(songAfter.title).toBe(songBefore.title);
    expect(songAfter.firstSeenAt).toEqual(songBefore.firstSeenAt);
    expect(songAfter.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(songBefore.lastSeenAt!.getTime());

    await prisma.videoReviewCandidate.update({ where: { source_externalId: { source: 'youtube', externalId: 'interview' } }, data: { decision: 'pending' } });
    await prisma.videoReviewCandidate.update({ where: { source_externalId: { source: 'youtube', externalId: 'song-video' } }, data: { decision: 'approved', title: 'Manually confirmed song' } });
    await pollAndGrabYoutubeSource(source.id);
    expect(await prisma.videoReviewCandidate.findUnique({ where: { source_externalId: { source: 'youtube', externalId: 'interview' } } }))
      .toMatchObject({ decision: 'rejected' });
    expect(await prisma.videoReviewCandidate.findUnique({ where: { source_externalId: { source: 'youtube', externalId: 'song-video' } } }))
      .toMatchObject({ decision: 'approved', title: 'Manually confirmed song' });
  });
});

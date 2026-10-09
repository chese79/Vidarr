import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createMusicVideoFile } from './support/db.js';

const imvdb = vi.hoisted(() => ({ videos: vi.fn() }));
vi.mock('../src/providers/metadata/imvdb.js', () => ({ getArtistVideos: imvdb.videos }));
import { refreshArtistMetadata } from '../src/pipeline/metadataRefresh.js';

const candidate = (id: string, title = 'Song') => ({
  imvdbVideoId: id, title, year: 2000, thumbnailUrl: null, director: null,
  durationSeconds: 200, youtubeVideoId: null,
  sources: [{ provider: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, externalId: id }],
});

describe('IMVDb catalog identities', () => {
  let artistId: number;
  beforeEach(async () => {
    await resetDb();
    imvdb.videos.mockReset();
    const root = await createRootFolder();
    const profile = await createQualityProfile((await createQuality()).id);
    const artist = await createArtist(root.id, profile.id);
    artistId = artist.id;
    await prisma.artist.update({ where: { id: artistId }, data: { imvdbArtistId: 'artist' } });
  });

  it('keeps a new same-title version separate from an owned video and its playlist', async () => {
    const owned = await createMusicVideo(artistId, { title: 'Song', hasFile: true });
    await prisma.musicVideo.update({ where: { id: owned.id }, data: { imvdbVideoId: 'A' } });
    await createMusicVideoFile(owned.id, { path: '/media/original.mp4' });
    const playlist = await prisma.playlist.create({ data: { name: 'Original', items: { create: { musicVideoId: owned.id, sortOrder: 0 } } } });
    imvdb.videos.mockResolvedValue([candidate('A'), candidate('B')]);
    expect(await refreshArtistMetadata(artistId)).toMatchObject({ videosAdded: 1, videosUpdated: 1 });

    const first = await prisma.musicVideo.findUniqueOrThrow({ where: { imvdbVideoId: 'A' }, include: { file: true, acquisitionSources: true } });
    const second = await prisma.musicVideo.findUniqueOrThrow({ where: { imvdbVideoId: 'B' }, include: { acquisitionSources: true } });
    expect(first.id).toBe(owned.id);
    expect(first.file?.path).toBe('/media/original.mp4');
    expect(first.hasFile).toBe(true);
    expect(second.hasFile).toBe(false);
    expect(second.title).toBe('Song (Version 2)');
    expect(first.acquisitionSources.map(s => s.externalId)).toEqual(['A']);
    expect(second.acquisitionSources.map(s => s.externalId)).toEqual(['B']);
    expect((await prisma.playlistItem.findFirstOrThrow({ where: { playlistId: playlist.id } })).musicVideoId).toBe(owned.id);

    // Reordering provider results must not exchange version identities or labels.
    imvdb.videos.mockResolvedValue([candidate('B'), candidate('A')]);
    expect(await refreshArtistMetadata(artistId)).toMatchObject({ videosAdded: 0, videosUpdated: 2 });
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { imvdbVideoId: 'B' } })).title).toBe('Song (Version 2)');
    expect(await prisma.musicVideo.count({ where: { artistId } })).toBe(2);
  });

  it('adopts an unambiguous legacy title entry without replacing its file', async () => {
    const legacy = await createMusicVideo(artistId, { title: 'Song', hasFile: true });
    imvdb.videos.mockResolvedValue([candidate('A')]);
    await refreshArtistMetadata(artistId);
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { imvdbVideoId: 'A' } })).id).toBe(legacy.id);
  });

  it('does not assign an ambiguous pair of provider versions to an unknown legacy identity', async () => {
    const legacy = await createMusicVideo(artistId, { title: 'Song', hasFile: true });
    imvdb.videos.mockResolvedValue([candidate('A'), candidate('B')]);
    expect(await refreshArtistMetadata(artistId)).toMatchObject({ videosAdded: 2 });
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: legacy.id } })).imvdbVideoId).toBeNull();
    expect(await prisma.musicVideo.count({ where: { artistId } })).toBe(3);
  });
});

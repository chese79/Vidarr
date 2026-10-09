import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createLibraryConnector } from './support/db.js';

const provider = vi.hoisted(() => ({ fetchVideos: vi.fn() }));
vi.mock('../src/providers/library/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/library/index.js')>()),
  getLibraryConnectorProvider: () => ({ testConnection: vi.fn(), fetchArtists: vi.fn(), fetchVideos: provider.fetchVideos }),
}));

import { syncConnectorVideos } from '../src/pipeline/libraryVideoSync.js';

describe('syncConnectorVideos identity parsing', () => {
  let rootFolderId: number;
  let qualityProfileId: number;
  let connectorId: number;

  const connector = () => prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
  const server = (externalId: string, title: string, artistName: string, path: string) =>
    ({ externalId, title, artistName, path, releaseYear: null, durationSeconds: null });
  async function catalog(artistName: string, titles: string[]) {
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: artistName });
    const videos = [];
    for (const title of titles) videos.push(await createMusicVideo(artist.id, { title }));
    return { artist, videos };
  }

  beforeEach(async () => {
    await resetDb();
    provider.fetchVideos.mockReset().mockResolvedValue([]);
    rootFolderId = (await createRootFolder()).id;
    qualityProfileId = (await createQualityProfile((await createQuality()).id)).id;
    const created = await createLibraryConnector({ name: 'JF' });
    connectorId = (await prisma.libraryConnector.update({ where: { id: created.id }, data: { videoLibraryId: 'lib' } })).id;
  });

  it('matches by file name when the server reports an uploader as the artist', async () => {
    const { videos } = await catalog('Deftones', ['7 Words']);
    provider.fetchVideos.mockResolvedValue([server('a', 'deftones - 7 Words', 'SuperDeftoner', '/media/music videos/Deftones - 7 Words.mp4')]);

    const result = await syncConnectorVideos(await connector());

    expect(result.matched).toEqual({ confirmed: 1, probable: 0, ambiguous: 0, unmatched: 0 });
    const row = await prisma.libraryVideo.findFirstOrThrow();
    expect(row).toMatchObject({ musicVideoId: videos[0].id, matchConfidence: null, normalizedArtistName: 'deftones', normalizedTitle: '7 words' });
    // What the server reported is kept exactly as reported.
    expect(row).toMatchObject({ artistName: 'SuperDeftoner', title: 'deftones - 7 Words' });
    expect(await prisma.artist.count({ where: { name: 'SuperDeftoner' } })).toBe(0);
  });

  it('works with Windows paths and strips upload noise from the title', async () => {
    const { videos } = await catalog('Echo and the Bunnymen', ['Lips Like Sugar']);
    provider.fetchVideos.mockResolvedValue([
      server('a', 'Echo and the Bunnymen - Lips Like Sugar (Official Music Video)', 'Unknown Artist',
        'D:\\media\\libraries\\music videos\\Echo and the Bunnymen - Lips Like Sugar (Official Music Video).mp4'),
    ]);
    await syncConnectorVideos(await connector());
    expect(await prisma.libraryVideo.findFirstOrThrow()).toMatchObject({ musicVideoId: videos[0].id, matchConfidence: null });
  });

  it("falls back to the server's own title when the file name matches nothing", async () => {
    const { videos } = await catalog('Beck', ['Devils Haircut']);
    provider.fetchVideos.mockResolvedValue([server('a', 'Beck - Devils Haircut', 'BeckVEVO', '/media/music videos/Beck - Some Other Name.mp4')]);
    await syncConnectorVideos(await connector());
    expect(await prisma.libraryVideo.findFirstOrThrow()).toMatchObject({ musicVideoId: videos[0].id, matchConfidence: null });
  });

  it('does not confirm a different version of a song just because the title is similar', async () => {
    await catalog('Blur', ['Beetlebum']);
    provider.fetchVideos.mockResolvedValue([server('a', 'x', 'Unknown Artist', '/m/Blur - Beetlebum (Mario Caldato Jr. mix).mp4')]);
    await syncConnectorVideos(await connector());
    // Either no match or a fuzzy one — never "confirmed", so it cannot silently stand in for the original.
    const row = await prisma.libraryVideo.findFirstOrThrow();
    expect(row.musicVideoId !== null && row.matchConfidence === null).toBe(false);
  });

  it('records a new artist under its real name, with a sort name that drops "The"', async () => {
    provider.fetchVideos.mockResolvedValue([server('a', 'x', 'chunkletguy', '/m/The Apples in Stereo - Can You Feel It.mp4')]);
    await syncConnectorVideos(await connector());
    expect(await prisma.artist.findFirstOrThrow({ where: { name: 'The Apples in Stereo' } }))
      .toMatchObject({ sortName: 'Apples in Stereo', musicbrainzMatchStatus: 'unmatched' });
    expect(await prisma.artist.count({ where: { name: 'chunkletguy' } })).toBe(0);
  });

  it('still falls back to the server artist, once, when nothing can be parsed from the video', async () => {
    provider.fetchVideos.mockResolvedValue([
      server('a', 'One', 'Brand New Artist', '/m/One.mp4'),
      server('b', 'Two', 'Brand New Artist', '/m/Two.mp4'),
    ]);
    await syncConnectorVideos(await connector());
    expect(await prisma.artist.count({ where: { name: 'Brand New Artist' } })).toBe(1);
  });

  it('does not create artists from fragments of a file name', async () => {
    provider.fetchVideos.mockResolvedValue([
      server('a', 'x', 'Unknown Artist', '/m/(HD) Wilco w_ Yo La Tengo- Spiders - Jam.mp4'),
      server('b', 'y', 'Unknown Artist', '/m/09 - Underneath The Sycamore.mp4'),
    ]);
    const before = await prisma.artist.count();
    await syncConnectorVideos(await connector());
    expect(await prisma.artist.count()).toBe(before);
  });

  it('refreshes stored names and the match for a row the server has not changed', async () => {
    const { videos } = await catalog('Deftones', ['7 Words']);
    const row = server('a', 'deftones - 7 Words', 'SuperDeftoner', '/m/Deftones - 7 Words.mp4');
    await prisma.libraryVideo.create({ data: {
      connectorId, externalId: 'a', title: row.title, normalizedTitle: 'deftones 7 words', artistName: row.artistName,
      normalizedArtistName: 'superdeftoner', path: row.path, available: true, musicVideoId: null, matchConfidence: null,
    } });
    provider.fetchVideos.mockResolvedValue([row]);
    await syncConnectorVideos(await connector());
    expect(await prisma.libraryVideo.findFirstOrThrow())
      .toMatchObject({ normalizedArtistName: 'deftones', normalizedTitle: '7 words', musicVideoId: videos[0].id });
  });

  describe('retiring artist records left by earlier syncs', () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const leftover = async (name: string, data: Record<string, unknown> = {}) => {
      const artist = await prisma.artist.create({ data: { name, sortName: name, rootFolderId, qualityProfileId, monitored: false, ...data } });
      await prisma.artistSource.create({ data: { artistId: artist.id, provider: 'jellyfin', origin: `video-connector:${connectorId}`, externalId: name, lastSeenAt: old } });
      return artist;
    };

    it('removes only unidentified, unmonitored artists that nothing else refers to', async () => {
      const plain = await leftover('uploader one');
      const identified = await leftover('Identified', { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: '00000000-0000-4000-8000-000000000001' });
      const monitored = await leftover('Monitored One', { monitored: true });
      const withVideo = await leftover('Has Catalog');
      await createMusicVideo(withVideo.id, { title: 'Catalog Video' });
      const heardElsewhere = await leftover('Also In Audio Library');
      await prisma.artistSource.create({ data: { artistId: heardElsewhere.id, provider: 'jellyfin', origin: `connector:${connectorId}`, externalId: 'audio-1' } });
      provider.fetchVideos.mockResolvedValue([server('a', 'x', 'Unknown Artist', '/m/Some Band - Some Song.mp4')]);

      const result = await syncConnectorVideos(await connector());

      expect(result.prunedArtists).toBe(1);
      expect(await prisma.artist.findUnique({ where: { id: plain.id } })).toBeNull();
      for (const keep of [identified, monitored, withVideo, heardElsewhere]) {
        expect(await prisma.artist.findUnique({ where: { id: keep.id } }), keep.name).not.toBeNull();
      }
      // The stale link itself goes even where the artist stays; other provenance is untouched.
      expect(await prisma.artistSource.count({ where: { artistId: identified.id, origin: `video-connector:${connectorId}` } })).toBe(0);
      expect(await prisma.artistSource.count({ where: { artistId: heardElsewhere.id, origin: `connector:${connectorId}` } })).toBe(1);
    });

    it('leaves artists that this sync still sees', async () => {
      const seen = await leftover('Some Band');
      provider.fetchVideos.mockResolvedValue([server('a', 'x', 'Unknown Artist', '/m/Some Band - Some Song.mp4')]);
      const result = await syncConnectorVideos(await connector());
      expect(result.prunedArtists).toBe(0);
      expect(await prisma.artist.findUnique({ where: { id: seen.id } })).not.toBeNull();
    });

    it('removes nothing when the server returns no videos', async () => {
      const plain = await leftover('uploader one');
      provider.fetchVideos.mockResolvedValue([]);
      expect((await syncConnectorVideos(await connector())).prunedArtists).toBe(0);
      expect(await prisma.artist.findUnique({ where: { id: plain.id } })).not.toBeNull();
    });
  });
});

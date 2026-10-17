import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createLibraryConnector } from './support/db.js';

const provider = vi.hoisted(() => ({ fetchVideos: vi.fn() }));
vi.mock('../src/providers/library/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/library/index.js')>()),
  getLibraryConnectorProvider: () => ({ testConnection: vi.fn(), fetchArtists: vi.fn(), fetchVideos: provider.fetchVideos }),
}));

import { syncConnectorVideos } from '../src/pipeline/libraryVideoSync.js';

const fetched = (externalId: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ externalId, title, artistName: 'Test Artist', releaseYear: null, durationSeconds: null, ...extra });

describe('syncConnectorVideos', () => {
  let connectorId: number;
  let artistId: number;

  const connector = () => prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
  const rows = async () => (await prisma.libraryVideo.findMany({ orderBy: { externalId: 'asc' } }));

  beforeEach(async () => {
    await resetDb();
    provider.fetchVideos.mockReset().mockResolvedValue([]);
    const rootFolder = await createRootFolder();
    const profile = await createQualityProfile((await createQuality()).id);
    artistId = (await createArtist(rootFolder.id, profile.id, { name: 'Test Artist' })).id;
    const created = await createLibraryConnector({ name: 'JF' });
    connectorId = (await prisma.libraryConnector.update({ where: { id: created.id }, data: { videoLibraryId: 'lib' } })).id;
  });

  it('records server videos and matches them to the catalog', async () => {
    const video = await createMusicVideo(artistId, { title: 'Song One' });
    provider.fetchVideos.mockResolvedValue([fetched('a', 'Song One'), fetched('b', 'Not In Catalog')]);

    expect(await syncConnectorVideos(await connector())).toMatchObject({ videoCount: 2, matched: { confirmed: 1, unmatched: 1 } });

    const [a, b] = await rows();
    expect(a).toMatchObject({ externalId: 'a', available: true, musicVideoId: video.id, matchConfidence: null });
    expect(b).toMatchObject({ externalId: 'b', available: true, musicVideoId: null });
  });

  it('keeps unchanged rows available on a repeat sync without losing their match', async () => {
    const video = await createMusicVideo(artistId, { title: 'Song One' });
    provider.fetchVideos.mockResolvedValue([fetched('a', 'Song One', { playCount: 3 })]);
    await syncConnectorVideos(await connector());
    const first = (await rows())[0];

    await new Promise((r) => setTimeout(r, 15));
    await syncConnectorVideos(await connector());
    const second = (await rows())[0];

    expect(second).toMatchObject({ available: true, musicVideoId: video.id, matchConfidence: null, playCount: 3 });
    expect(second.id).toBe(first.id);
    expect(second.lastSyncedAt.getTime()).toBeGreaterThan(first.lastSyncedAt.getTime());
  });

  it('updates a row whose details changed on the server', async () => {
    provider.fetchVideos.mockResolvedValue([fetched('a', 'Song One', { playCount: 1, releaseYear: 2001 })]);
    await syncConnectorVideos(await connector());
    provider.fetchVideos.mockResolvedValue([fetched('a', 'Song One (Remastered)', { playCount: 9, releaseYear: 2002 })]);
    await syncConnectorVideos(await connector());

    expect((await rows())[0]).toMatchObject({ title: 'Song One (Remastered)', playCount: 9, releaseYear: 2002, available: true });
  });

  it('confirms deliveries across bounded batches without accepting a different server path', async () => {
    const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
    await prisma.rootFolder.update({ where: { id: artist.rootFolderId }, data: { targetConnectorId: connectorId } });
    await prisma.musicVideo.createMany({ data: Array.from({ length: 1005 }, (_, index) => ({
      artistId, title: `Batch Song ${index}`, normalizedTitle: `batch song ${index}`,
      awaitingServerScanAt: new Date(),
    })) });
    const videos = await prisma.musicVideo.findMany({ orderBy: { id: 'asc' } });
    // Deliveries at both ends of the list must be confirmed; the middle one's
    // title matches but its server path points at an older copy.
    for (const video of [videos[0], videos[500], videos[1004]]) {
      await prisma.musicVideoFile.create({ data: {
        musicVideoId: video.id, path: `/media/test-root/Test Artist/${video.id}.mp4`,
        sizeBytes: 1024n, originalFilename: 'source.mp4',
      } });
    }
    provider.fetchVideos.mockResolvedValue(videos.map((video, index) => fetched(String(video.id), video.title, {
      path: index === 500 ? '/server/older-copy.mp4' : `/server/Test Artist/${video.id}.mp4`,
    })));
    const queries = vi.spyOn(prisma.musicVideo, 'findMany');
    try {
      expect(await syncConnectorVideos(await connector())).toMatchObject({
        videoCount: 1005, matched: { confirmed: 1005, unmatched: 0 },
      });
      const confirmationQueries = queries.mock.calls.filter(([query]) => query?.where?.awaitingServerScanAt);
      expect(confirmationQueries.length).toBeGreaterThan(1);
      for (const [query] of confirmationQueries) {
        const ids = (query!.where!.id as { in: number[] }).in;
        expect(ids.length).toBeLessThanOrEqual(500);
      }
    } finally {
      queries.mockRestore();
    }
    const saved = await prisma.musicVideo.findMany({ orderBy: { id: 'asc' } });
    expect(saved[0].awaitingServerScanAt).toBeNull();
    expect(saved[1004].awaitingServerScanAt).toBeNull();
    expect(saved[500].awaitingServerScanAt).not.toBeNull();
    expect(await prisma.musicVideo.count({ where: { awaitingServerScanAt: { not: null } } })).toBe(1003);
    expect(await prisma.libraryVideo.count({ where: { available: true, matchConfidence: null } })).toBe(1005);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artistId } })).reconciledAt).not.toBeNull();
  }, 30000);

  it('marks a video that left the server unavailable, and reinstates it if it returns', async () => {
    provider.fetchVideos.mockResolvedValue([fetched('a', 'One'), fetched('b', 'Two')]);
    await syncConnectorVideos(await connector());
    provider.fetchVideos.mockResolvedValue([fetched('a', 'One')]);
    await syncConnectorVideos(await connector());
    expect((await rows()).map((r) => [r.externalId, r.available])).toEqual([['a', true], ['b', false]]);

    provider.fetchVideos.mockResolvedValue([fetched('a', 'One'), fetched('b', 'Two')]);
    await syncConnectorVideos(await connector());
    expect((await rows()).map((r) => r.available)).toEqual([true, true]);
  });

  it('an empty server response keeps what was known rather than wiping availability', async () => {
    provider.fetchVideos.mockResolvedValue([fetched('a', 'One')]);
    await syncConnectorVideos(await connector());
    provider.fetchVideos.mockResolvedValue([]);
    expect(await syncConnectorVideos(await connector())).toMatchObject({ videoCount: 0, matched: { confirmed: 0, probable: 0, ambiguous: 0, unmatched: 0 } });
    expect((await rows())[0].available).toBe(true);
  });

  it('keeps a previously confirmed match when the title no longer matches, and honours a rejection', async () => {
    const wanted = await createMusicVideo(artistId, { title: 'Song One' });
    provider.fetchVideos.mockResolvedValue([fetched('a', 'Song One')]);
    await syncConnectorVideos(await connector());

    provider.fetchVideos.mockResolvedValue([fetched('a', 'Totally Renamed Upstream')]);
    await syncConnectorVideos(await connector());
    expect((await rows())[0]).toMatchObject({ musicVideoId: wanted.id });

    // "Not that one": the rejection must stick even though the exact title returns.
    await prisma.libraryVideo.updateMany({ data: { musicVideoId: null, matchConfidence: 'ambiguous', rejectedMusicVideoId: wanted.id } });
    provider.fetchVideos.mockResolvedValue([fetched('a', 'Song One')]);
    await syncConnectorVideos(await connector());
    expect((await rows())[0].musicVideoId).not.toBe(wanted.id);
  });

  it('creates an observation for a video artist Vidarr does not know yet, once (server artist as given)', async () => {
    provider.fetchVideos.mockResolvedValue([
      fetched('a', 'One', { artistName: 'Brand New Uploader' }),
      fetched('b', 'Two', { artistName: 'Brand New Uploader' }),
    ]);
    await syncConnectorVideos(await connector());
    expect(await prisma.artist.count({ where: { name: 'Brand New Uploader' } })).toBe(1);
    const created = await prisma.artist.findFirstOrThrow({ where: { name: 'Brand New Uploader' } });
    expect(created.musicbrainzMatchStatus).toBe('unmatched');
  });
});

describe('syncConnectorVideos artist observations on repeat syncs', () => {
  it('records a video source per artist once, refreshes last-seen without rewriting, and follows a changed external id', async () => {
    await resetDb();
    provider.fetchVideos.mockReset();
    const rootFolder = await createRootFolder();
    const profile = await createQualityProfile((await createQuality()).id);
    await createArtist(rootFolder.id, profile.id, { name: 'Test Artist' });
    const created = await createLibraryConnector({ name: 'JF' });
    const connector = () => prisma.libraryConnector.update({ where: { id: created.id }, data: { videoLibraryId: 'lib' } });
    const source = () => prisma.artistSource.findFirstOrThrow({ where: { origin: `video-connector:${created.id}` } });

    provider.fetchVideos.mockResolvedValue([fetched('a', 'One'), fetched('b', 'Two')]);
    await syncConnectorVideos(await connector());
    const first = await source();
    expect(first.externalId).toBe('a');
    expect(await prisma.artistSource.count({ where: { origin: `video-connector:${created.id}` } })).toBe(1);

    await new Promise((r) => setTimeout(r, 15));
    await syncConnectorVideos(await connector());
    const second = await source();
    expect(second.id).toBe(first.id);
    expect(second.externalId).toBe('a');
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());

    // The first video the server lists for this artist changes: the source follows it.
    provider.fetchVideos.mockResolvedValue([fetched('z', 'Zed'), fetched('a', 'One')]);
    await syncConnectorVideos(await connector());
    expect((await source()).externalId).toBe('z');
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist } from './support/db.js';
import { listChannelVideos } from '../src/providers/youtube/ytdlp.js';
import { lookupMusicBrainzArtist } from '../src/providers/metadata/musicbrainz.js';

vi.mock('../src/providers/metadata/musicbrainz.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/metadata/musicbrainz.js')>()),
  lookupMusicBrainzArtist: vi.fn().mockResolvedValue({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Test Artist', sortName: 'Test Artist',
    type: 'Person', country: null, disambiguation: null, genres: [], aliases: [],
    imvdbSlug: null, youtubeChannels: ['https://www.youtube.com/@testartist'],
  }),
}));
vi.mock('../src/providers/youtube/ytdlp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/youtube/ytdlp.js')>()),
  listChannelVideos: vi.fn().mockResolvedValue([{ youtubeVideoId: 'test-song', title: 'Test Artist - Song (Official Music Video)' }]),
}));
vi.mock('../src/providers/youtube/musicDiscovery.js', async (original) => ({
  ...(await original<typeof import('../src/providers/youtube/musicDiscovery.js')>()),
  discoverYoutubeChannel: vi.fn(async (url: string) => ({ errors: [],
    videos: (await listChannelVideos(url)).map(v => ({ ...v, officialEvidence: [], discoveryOrigins: ['channel-uploads'] })),
  })),
}));
vi.mock('../src/providers/metadata/imvdb.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/providers/metadata/imvdb.js')>()),
  findPublicArtistSlug: vi.fn().mockResolvedValue(null),
}));

describe('automatic video inventory backfill', () => {
  let rootPath: string;
  beforeEach(async () => {
    await resetDb();
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-video-backfill-'));
  });
  afterEach(async () => { await fs.rm(rootPath, { recursive: true, force: true }); });

  async function confirmedArtist() {
    const root = await createRootFolder({ path: rootPath });
    const profile = await createQualityProfile((await createQuality()).id);
    const artist = await createArtist(root.id, profile.id);
    return prisma.artist.update({ where: { id: artist.id }, data: {
      musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', musicbrainzMatchStatus: 'confirmed',
    } });
  }

  it('retries partial checks after cooldown without erasing earlier candidates or success timestamps', async () => {
    const artist = await confirmedArtist();
    const { backfillArtistVideoInventories } = await import('../src/pipeline/artistVideoBackfill.js');
    await backfillArtistVideoInventories();
    const successful = await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } });
    vi.mocked(listChannelVideos).mockRejectedValueOnce(new Error('YouTube temporarily unavailable'));
    const { collectArtistVideoInventory } = await import('../src/pipeline/artistVideoInventory.js');
    await collectArtistVideoInventory(artist.id);
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ videoInventoryStatus: 'partial', videoInventoryCompletedAt: successful.videoInventoryCompletedAt });
    expect(await prisma.videoReviewCandidate.count({ where: { artistId: artist.id } })).toBe(1);
    expect((await backfillArtistVideoInventories()).attempted).toBe(0);
    await prisma.artist.update({ where: { id: artist.id }, data: { videoInventoryAttemptedAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await backfillArtistVideoInventories()).attempted).toBe(1);
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ videoInventoryStatus: 'complete', videoInventoryError: null });
    expect(await prisma.videoReviewCandidate.count({ where: { artistId: artist.id } })).toBe(1);
  });

  it('continues existing channels when identity enrichment fails and retries an interrupted collection', async () => {
    const artist = await confirmedArtist();
    await prisma.youtubeSource.create({ data: { artistId: artist.id, url: 'https://www.youtube.com/@testartist', type: 'channel' } });
    vi.mocked(lookupMusicBrainzArtist).mockRejectedValueOnce(new Error('MusicBrainz offline'));
    const { collectArtistVideoInventory } = await import('../src/pipeline/artistVideoInventory.js');
    const first = collectArtistVideoInventory(artist.id, { enrichIdentity: true });
    expect(collectArtistVideoInventory(artist.id)).toBe(first);
    expect(await first).toMatchObject({ pendingYoutube: 1, errors: ['MusicBrainz: MusicBrainz offline'] });
    await prisma.artist.update({ where: { id: artist.id }, data: { videoInventoryStatus: 'running', videoInventoryAttemptedAt: new Date(Date.now() - 11 * 60_000) } });
    const { backfillArtistVideoInventories } = await import('../src/pipeline/artistVideoBackfill.js');
    expect((await backfillArtistVideoInventories()).attempted).toBe(1);
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ videoInventoryStatus: 'complete' });
  });

  it('uses already validated addition metadata without a second MusicBrainz request', async () => {
    const artist = await confirmedArtist();
    const metadata = await lookupMusicBrainzArtist(artist.musicbrainzArtistId!);
    vi.mocked(lookupMusicBrainzArtist).mockClear();
    const { collectArtistVideoInventory } = await import('../src/pipeline/artistVideoInventory.js');
    await collectArtistVideoInventory(artist.id, { enrichIdentity: true, metadata });
    expect(lookupMusicBrainzArtist).not.toHaveBeenCalled();
    expect(await prisma.youtubeSource.count({ where: { artistId: artist.id } })).toBe(1);
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ videoInventoryStatus: 'complete' });
  });

  it('collects sources once for a confirmed artist and records completion', async () => {
    const root = await createRootFolder({ path: rootPath });
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    await prisma.artist.update({ where: { id: artist.id }, data: {
      musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', musicbrainzMatchStatus: 'confirmed',
    } });
    const { backfillArtistVideoInventories } = await import('../src/pipeline/artistVideoBackfill.js');
    expect(await backfillArtistVideoInventories()).toMatchObject({ checked: 1, attempted: 1, remaining: 0 });
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ videoInventoryError: null });
    expect((await prisma.artist.findUnique({ where: { id: artist.id } }))?.videoInventoryCheckedAt).not.toBeNull();
    expect(await prisma.videoReviewCandidate.findFirst({ where: { artistId: artist.id, source: 'youtube' } }))
      .toMatchObject({ externalId: 'test-song', decision: 'pending' });
    expect(await backfillArtistVideoInventories()).toMatchObject({ checked: 0, attempted: 0, remaining: 0 });
  });

  it('scans a linked YouTube and YouTube Music channel only once', async () => {
    const root = await createRootFolder({ path: rootPath });
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    await prisma.artist.update({ where: { id: artist.id }, data: {
      musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', musicbrainzMatchStatus: 'confirmed',
    } });
    const first = await prisma.youtubeSource.create({ data: { artistId: artist.id, url: 'https://www.youtube.com/channel/UCtest', type: 'channel' } });
    const second = await prisma.youtubeSource.create({ data: { artistId: artist.id, url: 'https://music.youtube.com/channel/UCtest', type: 'channel' } });
    vi.mocked(listChannelVideos).mockClear();
    const { collectArtistVideoInventory } = await import('../src/pipeline/artistVideoInventory.js');
    await collectArtistVideoInventory(artist.id, { refreshImvdb: false, scanLocal: false });
    expect(listChannelVideos).toHaveBeenCalledTimes(1);
    expect((await prisma.youtubeSource.findUnique({ where: { id: first.id } }))?.lastPolledAt).not.toBeNull();
    expect((await prisma.youtubeSource.findUnique({ where: { id: second.id } }))?.lastPolledAt).not.toBeNull();
  });
});

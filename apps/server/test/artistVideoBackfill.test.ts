import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist } from './support/db.js';

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
});

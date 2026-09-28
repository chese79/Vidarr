import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { artistNameSearchVariants, confirmArtistIdentity, discoverArtistIdentityCandidates } from '../src/pipeline/artistIdentity.js';
import { lookupMusicBrainzArtist, searchMusicBrainzArtists } from '../src/providers/metadata/musicbrainz.js';
import { createArtist, createLibraryConnector, createQuality, createQualityProfile, createRootFolder, resetDb } from './support/db.js';

const lookups = vi.hoisted(() => ({
  recording: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../src/providers/metadata/musicbrainz.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/providers/metadata/musicbrainz.js')>();
  return {
    ...original,
    searchMusicBrainzArtists: vi.fn().mockResolvedValue([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Shared Name', sortName: 'Shared Name', type: null, country: null, disambiguation: null, genres: [], aliases: [], score: 100 },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Shared Name', sortName: 'Shared Name', type: null, country: null, disambiguation: null, genres: [], aliases: [], score: 95 },
    ]),
    lookupRecordingArtistIds: lookups.recording,
    lookupReleaseArtistIds: lookups.release,
    lookupMusicBrainzArtist: vi.fn(),
  };
});

vi.mock('../src/pipeline/metadataRefresh.js', () => ({ refreshArtistMetadata: vi.fn() }));
vi.mock('../src/pipeline/artistVideoInventory.js', () => ({ collectArtistVideoInventory: vi.fn().mockResolvedValue({ official: 0, approvedOther: 0, pendingYoutube: 0, pendingLocal: 0, errors: [] }) }));

describe('observed artist-credit match evidence', () => {
  beforeEach(async () => {
    await resetDb();
    lookups.recording.mockReset();
    lookups.release.mockReset();
  });

  it('searches joined names and featuring credits by the primary artist', async () => {
    expect(artistNameSearchVariants('AmyWinehouse')).toEqual(['Amy Winehouse', 'AmyWinehouse']);
    expect(artistNameSearchVariants('Amy Winehouse featuring Tony Bennett')).toEqual(['Amy Winehouse']);
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id, { name: 'AmyWinehouse' });
    vi.mocked(searchMusicBrainzArtists).mockClear();
    await discoverArtistIdentityCandidates(artist.id);
    expect(searchMusicBrainzArtists).toHaveBeenCalledWith('Amy Winehouse');
  });

  it('restores suggestions on rediscovery and reports a failed confirmation', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id, { name: 'Shared Name' });
    await discoverArtistIdentityCandidates(artist.id);
    await prisma.musicBrainzArtistCandidate.updateMany({ where: { artistId: artist.id }, data: { status: 'rejected' } });
    expect(await discoverArtistIdentityCandidates(artist.id)).toHaveLength(2);
    vi.mocked(lookupMusicBrainzArtist).mockRejectedValueOnce(new Error('MusicBrainz unavailable'));
    await expect(confirmArtistIdentity(artist.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow('confirmation failed');
    expect(await prisma.musicBrainzArtistCandidate.count({ where: { artistId: artist.id, status: 'suggested' } })).toBe(2);
  });

  it('links a duplicate observation to an existing Library artist without deleting its source evidence', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const owner = await createArtist(root.id, profile.id, { name: 'Amy Winehouse' });
    const observation = await createArtist(root.id, profile.id, { name: 'AmyWinehouse' });
    const mbid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await prisma.artist.update({ where: { id: owner.id }, data: { musicbrainzArtistId: mbid, musicbrainzMatchStatus: 'confirmed' } });
    await prisma.artistSource.create({ data: { artistId: observation.id, provider: 'jellyfin', origin: 'connector:4', externalId: 'source-amy' } });
    await prisma.videoReviewCandidate.create({ data: { source: 'youtube', externalId: 'amy-video', artistId: observation.id, artistName: 'AmyWinehouse', title: 'Song' } });
    const result = await confirmArtistIdentity(observation.id, mbid);
    expect(result.id).toBe(owner.id);
    const linked = await prisma.artist.findUniqueOrThrow({ where: { id: observation.id } });
    expect(linked.musicbrainzMatchStatus).toBe('linked');
    expect(JSON.parse(linked.musicbrainzMatchEvidence!)).toMatchObject({ canonicalArtistId: owner.id });
    expect(await prisma.artistSource.count({ where: { artistId: observation.id, externalId: 'source-amy' } })).toBe(1);
    expect((await prisma.videoReviewCandidate.findUniqueOrThrow({ where: { source_externalId: { source: 'youtube', externalId: 'amy-video' } } })).artistId).toBe(owner.id);
  });

  it('ranks the artist credited on observed recordings and releases ahead of an equal-name result', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id, { name: 'Shared Name' });
    const connector = await createLibraryConnector();
    await prisma.libraryRecording.create({ data: {
      connectorId: connector.id,
      filePath: '/music/one.flac',
      title: 'One',
      artistName: 'Shared Name',
      albumArtistName: 'Shared Name',
      musicbrainzRecordingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      musicbrainzReleaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    } });
    lookups.recording.mockResolvedValue(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    lookups.release.mockResolvedValue(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);

    const candidates = await discoverArtistIdentityCandidates(artist.id);

    expect(candidates[0].musicbrainzArtistId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(JSON.parse(candidates[0].evidence)).toMatchObject({ recordingMatchCount: 1, releaseMatchCount: 1 });
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).musicbrainzMatchStatus).toBe('suggested');
  });

  it('keeps name-based suggestions available when a credit lookup fails', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id, { name: 'Shared Name' });
    const connector = await createLibraryConnector();
    await prisma.libraryRecording.create({ data: {
      connectorId: connector.id,
      filePath: '/music/one.flac',
      title: 'One',
      artistName: 'Shared Name',
      musicbrainzRecordingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    } });
    lookups.recording.mockRejectedValue(new Error('temporarily unavailable'));

    const candidates = await discoverArtistIdentityCandidates(artist.id);

    expect(candidates).toHaveLength(2);
    expect(JSON.parse(candidates[0].evidence).recordingMatchCount).toBe(0);
  });
});

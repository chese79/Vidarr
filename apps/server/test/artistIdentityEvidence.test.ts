import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { discoverArtistIdentityCandidates } from '../src/pipeline/artistIdentity.js';
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
  };
});

describe('observed artist-credit match evidence', () => {
  beforeEach(async () => {
    await resetDb();
    lookups.recording.mockReset();
    lookups.release.mockReset();
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

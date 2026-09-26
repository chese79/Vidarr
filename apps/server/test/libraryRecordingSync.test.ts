import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/client.js';
import { syncLibraryRecordings } from '../src/pipeline/libraryRecordingSync.js';
import { createLibraryConnector, resetDb } from './support/db.js';

describe('observed audio recording reconciliation', () => {
  beforeEach(resetDb);

  it('upserts current files and removes stale files after a non-empty scan', async () => {
    const connector = await createLibraryConnector();
    await prisma.libraryRecording.createMany({ data: [
      {
        connectorId: connector.id,
        filePath: '/music/old.flac',
        title: 'Old',
        artistName: 'Artist',
        lastSyncedAt: new Date(0),
      },
      {
        connectorId: connector.id,
        filePath: '/music/current.flac',
        title: 'Outdated title',
        artistName: 'Artist',
        lastSyncedAt: new Date(0),
      },
    ] });

    await syncLibraryRecordings(connector.id, [{
      filePath: '/music/current.flac',
      title: 'Current title',
      album: 'Observed Album',
      artistName: 'Artist',
      musicbrainzRecordingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }], new Date(1));

    expect(await prisma.libraryRecording.findMany({ where: { connectorId: connector.id } })).toEqual([
      expect.objectContaining({
        filePath: '/music/current.flac',
        title: 'Current title',
        album: 'Observed Album',
        musicbrainzRecordingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    ]);
  });

  it('preserves prior observations when a scan returns no files', async () => {
    const connector = await createLibraryConnector();
    await prisma.libraryRecording.create({ data: {
      connectorId: connector.id,
      filePath: '/music/current.flac',
      title: 'Current',
      artistName: 'Artist',
      lastSyncedAt: new Date(0),
    } });

    await syncLibraryRecordings(connector.id, [], new Date());

    expect(await prisma.libraryRecording.count({ where: { connectorId: connector.id } })).toBe(1);
  });
});

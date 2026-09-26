import { prisma } from '../db/client.js';
import type { EmbeddedRecordingObservation } from './embeddedMusicScan.js';

const UPSERT_BATCH_SIZE = 250;

/**
 * Reconcile the audio files observed during one successful embedded-tag scan.
 * An empty observation set is deliberately non-destructive because it cannot
 * distinguish an empty library from a temporarily unavailable mount.
 */
export async function syncLibraryRecordings(
  connectorId: number,
  recordings: EmbeddedRecordingObservation[],
  syncStartedAt: Date,
): Promise<void> {
  const observedAt = new Date();
  for (let offset = 0; offset < recordings.length; offset += UPSERT_BATCH_SIZE) {
    const batch = recordings.slice(offset, offset + UPSERT_BATCH_SIZE);
    await prisma.$transaction(batch.map((recording) => prisma.libraryRecording.upsert({
      where: { connectorId_filePath: { connectorId, filePath: recording.filePath } },
      update: { ...recording, lastSyncedAt: observedAt },
      create: { connectorId, ...recording, lastSyncedAt: observedAt },
    })));
  }

  if (recordings.length > 0) {
    await prisma.libraryRecording.deleteMany({
      where: { connectorId, lastSyncedAt: { lt: syncStartedAt } },
    });
  }
}

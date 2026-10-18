import { prisma } from '../db/client.js';
import { deriveMediaLifecycle } from './lifecycle.js';

// One factual repository for compatibility music videos and new live captures.
// Trust, monitoring, coverage and qualified-play rules remain catalog policy decisions.
export async function recordingFacts(id: number) {
  const row = await prisma.recording.findUniqueOrThrow({ where: { id }, include: {
    parts: { include: { legacyMusicVideoFile: true, serverCopies: { include: { connector: true } } } },
    legacyServerObservations: { include: { connector: true } }, legacySources: true, sources: true,
    queueItems: { orderBy: [{ queuePosition: 'asc' }, { addedAt: 'desc' }, { id: 'desc' }] },
    musicVideo: { select: { awaitingServerScanAt: true } },
  } });
  const serverCopies = [...row.parts.flatMap(part => part.serverCopies.map(copy => ({ available: copy.available && copy.connector.enabled, confirmed: true }))),
    ...row.legacyServerObservations.map(copy => ({ available: copy.available && copy.connector.enabled, confirmed: copy.matchConfidence === null }))];
  return { recording: row, lifecycle: deriveMediaLifecycle({ localAvailable: row.parts.some(part => part.available && Boolean(part.path || part.legacyMusicVideoFile)),
    serverCopies, queueItems: row.queueItems, awaitingDelivery: Boolean(row.musicVideo?.awaitingServerScanAt) }) };
}

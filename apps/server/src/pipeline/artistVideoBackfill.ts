import { prisma, logActivity } from '../db/client.js';
import type { Prisma } from '@prisma/client';
import { collectArtistVideoInventory } from './artistVideoInventory.js';
import { redactMessage } from '../security/redact.js';
import { scanLocalVideoCandidates } from './localVideoReview.js';

export function sourceCollectionDue(now = new Date()): Prisma.ArtistWhereInput {
  return { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null },
    AND: [
      { OR: [{ videoInventoryCheckedAt: null }, { videoInventoryStatus: { in: ['pending', 'partial', 'failed', 'running'] } }] },
      { OR: [{ videoInventoryAttemptedAt: null }, { videoInventoryAttemptedAt: { lte: new Date(now.getTime() - 10 * 60_000) } }] },
    ],
  };
}

// Legacy confirmed artists predate automatic source collection. Process a
// bounded batch per run so one unavailable provider cannot stall every sync.
export async function backfillArtistVideoInventories(limit = 20) {
  const artists = await prisma.artist.findMany({
    where: sourceCollectionDue(),
    select: { id: true, musicbrainzArtistId: true },
    orderBy: [{ addedAt: 'desc' }, { id: 'desc' }], take: limit,
  });
  let checked = 0;
  // Share one traversal across this bounded batch; each artist still records
  // its local-stage outcome and retries if the shared scan fails.
  let localScan: Promise<unknown> | undefined;
  for (const artist of artists) {
    try {
      await collectArtistVideoInventory(artist.id, { enrichIdentity: true,
        localScan: () => localScan ??= scanLocalVideoCandidates() });
      checked++;
    } catch (error) {
      await prisma.artist.update({ where: { id: artist.id }, data: {
        videoInventoryAttemptedAt: new Date(), videoInventoryStatus: 'failed', videoInventoryError: redactMessage(error),
      } });
      await logActivity('warn', 'artist-video-backfill', error);
    }
  }
  const remaining = await prisma.artist.count({ where: sourceCollectionDue() });
  return { checked, attempted: artists.length, remaining };
}

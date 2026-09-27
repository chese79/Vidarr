import { prisma, logActivity } from '../db/client.js';
import { enrichConfirmedArtist } from './artistIdentity.js';
import { collectArtistVideoInventory } from './artistVideoInventory.js';
import { scanLocalVideoCandidates } from './localVideoReview.js';

// Legacy confirmed artists predate automatic source collection. Process a
// bounded batch per run so one unavailable provider cannot stall every sync.
export async function backfillArtistVideoInventories(limit = 20) {
  const artists = await prisma.artist.findMany({
    where: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null }, videoInventoryCheckedAt: null },
    select: { id: true, musicbrainzArtistId: true },
    orderBy: [{ addedAt: 'desc' }, { id: 'desc' }], take: limit,
  });
  let checked = 0;
  for (const artist of artists) {
    try {
      await enrichConfirmedArtist(artist.id, artist.musicbrainzArtistId!);
      await collectArtistVideoInventory(artist.id, { scanLocal: false });
      checked++;
    } catch (error) {
      await prisma.artist.update({ where: { id: artist.id }, data: {
        videoInventoryCheckedAt: new Date(), videoInventoryError: (error as Error).message,
      } });
      await logActivity('warn', 'artist-video-backfill', error);
    }
  }
  const remaining = await prisma.artist.count({ where: {
    musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null }, videoInventoryCheckedAt: null,
  } });
  if (artists.length && remaining === 0) {
    try { await scanLocalVideoCandidates(); }
    catch (error) { await logActivity('warn', 'artist-video-backfill:local', error); }
  }
  return { checked, attempted: artists.length, remaining };
}

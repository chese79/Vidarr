import { prisma, logActivity } from '../db/client.js';
import { refreshArtistMetadata } from './metadataRefresh.js';
import { scanLocalVideoCandidates } from './localVideoReview.js';
import { syncYoutubeSource } from './youtubeSync.js';

export interface ArtistVideoCollectionResult {
  official: number;
  approvedOther: number;
  pendingYoutube: number;
  pendingLocal: number;
  errors: string[];
}

// Collect the three launch inputs for one confirmed artist. A failing source
// does not erase records from another source or revoke artist confirmation.
export async function collectArtistVideoInventory(
  artistId: number,
  options: { refreshImvdb?: boolean; scanLocal?: boolean } = {},
): Promise<ArtistVideoCollectionResult> {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  if (artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) {
    throw new Error('Confirm the artist in MusicBrainz before collecting videos.');
  }
  const errors: string[] = [];
  if (options.refreshImvdb !== false) {
    try { await refreshArtistMetadata(artistId); }
    catch (error) {
      errors.push(`IMVDb: ${(error as Error).message}`);
      await logActivity('warn', 'artist-video-inventory:imvdb', error);
    }
  }
  const channels = await prisma.youtubeSource.findMany({ where: { artistId }, orderBy: { id: 'asc' } });
  for (const channel of channels) {
    try { await syncYoutubeSource(channel.id); }
    catch (error) {
      errors.push(`YouTube ${channel.url}: ${(error as Error).message}`);
      await logActivity('warn', 'artist-video-inventory:youtube', error);
    }
  }
  if (options.scanLocal !== false) {
    try { await scanLocalVideoCandidates(artistId); }
    catch (error) {
      errors.push(`Local files: ${(error as Error).message}`);
      await logActivity('warn', 'artist-video-inventory:local', error);
    }
  }
  await prisma.artist.update({ where: { id: artistId }, data: {
    videoInventoryCheckedAt: new Date(), videoInventoryError: errors.join('; ') || null,
  } });
  const [official, approvedOther, pendingYoutube, pendingLocal] = await Promise.all([
    prisma.musicVideo.count({ where: { artistId, catalogKind: 'official' } }),
    prisma.musicVideo.count({ where: { artistId, catalogKind: { not: 'official' } } }),
    prisma.videoReviewCandidate.count({ where: { artistId, source: 'youtube', decision: 'pending' } }),
    prisma.videoReviewCandidate.count({ where: { artistId, source: 'local', decision: 'pending' } }),
  ]);
  return { official, approvedOther, pendingYoutube, pendingLocal, errors };
}

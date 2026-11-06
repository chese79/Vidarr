import { prisma, logActivity } from '../db/client.js';
import { discoverArtistIdentityCandidates } from './artistIdentity.js';

let running = false;

// Search observations automatically; qualified matches use the validated confirmation path.
export async function backfillArtistIdentitySuggestions(limit = 3) {
  if (running) return 'Artist suggestion discovery already running';
  running = true;
  try {
    const artists = await prisma.artist.findMany({
      where: { musicbrainzArtistId: null, musicbrainzMatchStatus: { in: ['unmatched', 'failed', 'notFound', 'suggested'] },
        OR: [{ musicbrainzRefreshedAt: null }, { musicbrainzRefreshedAt: { lte: new Date(Date.now() - 24 * 60 * 60_000) } }] },
      orderBy: [{ musicbrainzRefreshedAt: 'asc' }, { id: 'asc' }], take: limit,
      select: { id: true },
    });
    let suggested = 0;
    let failed = 0;
    for (const artist of artists) {
      // Checkpoint before HTTP so restarts and provider outages cannot starve later rows.
      const claimed = await prisma.artist.updateMany({ where: { id: artist.id, musicbrainzArtistId: null,
        musicbrainzMatchStatus: { in: ['unmatched', 'failed', 'notFound', 'suggested'] } }, data: { musicbrainzRefreshedAt: new Date() } });
      if (!claimed.count) continue;
      try {
        if ((await discoverArtistIdentityCandidates(artist.id)).length) suggested++;
      } catch (error) {
        failed++;
        await prisma.artist.updateMany({ where: { id: artist.id, musicbrainzArtistId: null,
          musicbrainzMatchStatus: { in: ['unmatched', 'failed', 'notFound'] } }, data: { musicbrainzMatchStatus: 'failed' } });
        await logActivity('warn', 'artist-suggestions', error);
      }
    }
    return `${artists.length} observations checked, ${suggested} with suggestions, ${failed} failed; ambiguous/low-score matches require review`;
  } finally { running = false; }
}

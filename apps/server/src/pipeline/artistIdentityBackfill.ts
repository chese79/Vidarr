import { prisma, logActivity } from '../db/client.js';
import { autoConfirmStoredArtistIdentity, discoverArtistIdentityCandidates } from './artistIdentity.js';
import type { Prisma } from '@prisma/client';

let running = false;

// Search observations automatically; qualified matches use the validated confirmation path.
export async function backfillArtistIdentitySuggestions(limit = 3) {
  if (running) return 'Artist suggestion discovery already running';
  running = true;
  try {
    const unresolved: Prisma.ArtistWhereInput = {
      musicbrainzArtistId: null, musicbrainzMatchStatus: { in: ['unmatched', 'failed', 'notFound', 'suggested', 'ambiguous'] },
    };
    const retryBefore = new Date(Date.now() - 24 * 60 * 60_000);
    // Accept saved qualifying proposals first, instead of putting hundreds of
    // already scored artists behind fresh provider searches.
    const saved = await prisma.artist.findMany({
      where: { ...unresolved, musicbrainzCandidates: { some: { status: 'suggested', score: { gte: 0.82 } } },
        OR: [{ musicbrainzMatchEvidence: null }, { musicbrainzMatchEvidence: { not: { contains: '"autoConfirmationAttemptedAt"' } } },
          { musicbrainzRefreshedAt: { lte: retryBefore } }] },
      orderBy: [{ musicbrainzRefreshedAt: 'asc' }, { id: 'asc' }], take: limit,
      select: { id: true },
    });
    const artists = saved.length >= limit ? saved : [...saved, ...await prisma.artist.findMany({
      where: { ...unresolved, id: { notIn: saved.map(artist => artist.id) },
        OR: [{ musicbrainzRefreshedAt: null }, { musicbrainzRefreshedAt: { lte: retryBefore } }] },
      orderBy: [{ musicbrainzRefreshedAt: 'asc' }, { id: 'asc' }], take: limit - saved.length, select: { id: true },
    })];
    let suggested = 0;
    let failed = 0;
    for (const artist of artists) {
      // Checkpoint before HTTP so restarts and provider outages cannot starve later rows.
      const claimed = await prisma.artist.updateMany({ where: { id: artist.id, musicbrainzArtistId: null,
        musicbrainzMatchStatus: { in: ['unmatched', 'failed', 'notFound', 'suggested', 'ambiguous'] } }, data: { musicbrainzRefreshedAt: new Date() } });
      if (!claimed.count) continue;
      try {
        if (await autoConfirmStoredArtistIdentity(artist.id) || (await discoverArtistIdentityCandidates(artist.id)).length) suggested++;
      } catch (error) {
        failed++;
        await prisma.artist.updateMany({ where: { id: artist.id, musicbrainzArtistId: null,
          musicbrainzMatchStatus: { in: ['unmatched', 'failed', 'notFound'] } }, data: { musicbrainzMatchStatus: 'failed' } });
        await logActivity('warn', 'artist-suggestions', error);
      }
    }
    return `${artists.length} observations checked, ${suggested} matched or suggested, ${failed} failed; matches at 82% or above confirm automatically`;
  } finally { running = false; }
}

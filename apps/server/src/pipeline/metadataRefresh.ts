import { prisma } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { getArtistVideos } from '../providers/metadata/imvdb.js';

// Re-syncs each IMVDb-linked artist's video list, adding any newly-published
// videos IMVDb has picked up since the artist was added. `imvdbArtistId`
// stores the artist's IMVDb slug (see providers/metadata/imvdb.ts for why).
export async function refreshImvdbMetadata(): Promise<{ artistsChecked: number; videosAdded: number }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.imvdbApiKey) return { artistsChecked: 0, videosAdded: 0 };

  const artists = await prisma.artist.findMany({ where: { imvdbArtistId: { not: null } } });
  let videosAdded = 0;

  for (const artist of artists) {
    try {
      const videos = await getArtistVideos(settings.imvdbApiKey, artist.imvdbArtistId!, artist.name);
      const existingImvdbIds = new Set(
        (await prisma.musicVideo.findMany({ where: { artistId: artist.id }, select: { imvdbVideoId: true } })).map(
          (v) => v.imvdbVideoId,
        ),
      );

      for (const video of videos) {
        if (existingImvdbIds.has(video.imvdbVideoId)) continue;
        await prisma.musicVideo.create({
          data: {
            artistId: artist.id,
            title: video.title,
            normalizedTitle: normalizeTitle(video.title),
            imvdbVideoId: video.imvdbVideoId,
            releaseYear: video.year,
            thumbnailUrl: video.thumbnailUrl,
            monitored: true,
          },
        });
        videosAdded++;
      }
    } catch (err) {
      await prisma.activityLog.create({
        data: { level: 'warn', source: 'metadata-refresh', message: (err as Error).message },
      });
    }
  }

  return { artistsChecked: artists.length, videosAdded };
}

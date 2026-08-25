import { prisma } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { getArtistVideos } from '../providers/metadata/imvdb.js';

// Fetches an IMVDb-linked artist's current video list and creates any videos
// not already known (by imvdbVideoId). `imvdbArtistId` stores the artist's
// IMVDb slug (see providers/metadata/imvdb.ts for why). Used both by the
// scheduled metadata-refresh job (all artists) and by toggling an artist's
// Monitored flag on (that one artist, immediately).
export async function refreshArtistMetadata(artistId: number): Promise<{ videosAdded: number }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  if (!settings?.imvdbApiKey || !artist.imvdbArtistId) return { videosAdded: 0 };

  const videos = await getArtistVideos(settings.imvdbApiKey, artist.imvdbArtistId, artist.name);
  const existingImvdbIds = new Set(
    (
      await prisma.musicVideo.findMany({ where: { artistId }, select: { imvdbVideoId: true } })
    ).map((v) => v.imvdbVideoId),
  );

  let videosAdded = 0;
  for (const video of videos) {
    if (existingImvdbIds.has(video.imvdbVideoId)) continue;
    await prisma.musicVideo.create({
      data: {
        artistId,
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

  return { videosAdded };
}

export async function refreshImvdbMetadata(): Promise<{ artistsChecked: number; videosAdded: number }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.imvdbApiKey) return { artistsChecked: 0, videosAdded: 0 };

  const artists = await prisma.artist.findMany({ where: { imvdbArtistId: { not: null } } });
  let videosAdded = 0;

  for (const artist of artists) {
    try {
      const result = await refreshArtistMetadata(artist.id);
      videosAdded += result.videosAdded;
    } catch (err) {
      await prisma.activityLog.create({
        data: { level: 'warn', source: 'metadata-refresh', message: (err as Error).message },
      });
    }
  }

  return { artistsChecked: artists.length, videosAdded };
}

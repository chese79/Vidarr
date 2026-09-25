import { prisma, logActivity } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { getArtistVideos } from '../providers/metadata/imvdb.js';

// Fetches an IMVDb-linked artist's current video list and creates any videos
// not already known (by imvdbVideoId). `imvdbArtistId` stores the artist's
// IMVDb slug (see providers/metadata/imvdb.ts for why). Used both by the
// scheduled metadata-refresh job (all artists) and by toggling an artist's
// Monitored flag on (that one artist, immediately).
export interface MetadataRefreshResult {
  videosAdded: number;
  videosUpdated: number;
  videosFlaggedForReview: number;
}

export async function refreshArtistMetadata(artistId: number): Promise<MetadataRefreshResult> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  if (!settings?.imvdbApiKey || !artist.imvdbArtistId) {
    return { videosAdded: 0, videosUpdated: 0, videosFlaggedForReview: 0 };
  }

  const videos = await getArtistVideos(settings.imvdbApiKey, artist.imvdbArtistId, artist.name);
  const existing = await prisma.musicVideo.findMany({
    where: { artistId, imvdbVideoId: { not: null } },
    select: { id: true, imvdbVideoId: true },
  });
  const existingByImvdbId = new Map(existing.map((v) => [v.imvdbVideoId as string, v.id]));
  const seenIds = new Set(videos.map((video) => video.imvdbVideoId));

  let videosAdded = 0;
  let videosUpdated = 0;
  for (const video of videos) {
    try {
      const existingId = existingByImvdbId.get(video.imvdbVideoId);
      const data = {
        title: video.title,
        normalizedTitle: normalizeTitle(video.title),
        releaseYear: video.year,
        thumbnailUrl: video.thumbnailUrl,
        director: video.director,
        durationSeconds: video.durationSeconds,
        youtubeVideoId: video.youtubeVideoId,
        catalogStatus: 'active',
        lastSeenAt: new Date(),
        removedAt: null,
      };
      const saved = existingId
        ? await prisma.musicVideo.update({ where: { id: existingId }, data })
        : await prisma.musicVideo.create({
          data: {
          artistId,
          imvdbVideoId: video.imvdbVideoId,
          monitored: true,
          ...data,
        } });
      if (existingId) videosUpdated++;
      else videosAdded++;
      for (const source of video.sources) {
        await prisma.acquisitionSource.upsert({
          where: {
            musicVideoId_provider_url: {
              musicVideoId: saved.id,
              provider: source.provider,
              url: source.url,
            },
          },
          update: {
            externalId: source.externalId,
            authority: 'authoritative',
            confidence: 'confirmed',
            accepted: true,
          },
          create: {
            musicVideoId: saved.id,
            provider: source.provider,
            externalId: source.externalId,
            url: source.url,
            authority: 'authoritative',
            confidence: 'confirmed',
            discoveryOrigin: 'imvdb',
            accepted: true,
          },
        });
      }
    } catch (err) {
      await logActivity('warn', 'metadata-refresh:video', err);
    }
  }

  const removed = existing.filter((video) => !seenIds.has(video.imvdbVideoId as string));
  if (removed.length) {
    await prisma.musicVideo.updateMany({
      where: { id: { in: removed.map((video) => video.id) } },
      data: { catalogStatus: 'removedReview', removedAt: new Date() },
    });
  }
  await prisma.artist.update({
    where: { id: artistId },
    data: { metadataRefreshedAt: new Date() },
  });
  await prisma.artistSource.upsert({
    where: { artistId_provider_origin: { artistId, provider: 'imvdb', origin: 'metadata-refresh' } },
    update: { externalId: artist.imvdbArtistId, lastSeenAt: new Date() },
    create: { artistId, provider: 'imvdb', externalId: artist.imvdbArtistId, origin: 'metadata-refresh' },
  });
  return { videosAdded, videosUpdated, videosFlaggedForReview: removed.length };
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
      await logActivity('warn', 'metadata-refresh:artist', err);
    }
  }

  return { artistsChecked: artists.length, videosAdded };
}

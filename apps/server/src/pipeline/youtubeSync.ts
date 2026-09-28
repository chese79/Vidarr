import { prisma } from '../db/client.js';
import { listChannelVideos } from '../providers/youtube/ytdlp.js';
import { parseArtistAndTitle } from './bulkImport.js';
import { excludedMusicVideoTitleReason } from './youtubeValidation.js';
import { normalizeTitle } from './normalize.js';

export interface YoutubeSyncResult {
  matched: number;
  created: number;
  pending: number;
  affectedMusicVideoIds: number[];
  isInitialSync: boolean;
}

// A channel is a discovery hint. Its uploads are not catalog videos until a
// person confirms each song music video in Video Review. This applies to
// scheduled polls as well as a manual sync.
export async function syncYoutubeSource(sourceId: number): Promise<YoutubeSyncResult> {
  const source = await prisma.youtubeSource.findUniqueOrThrow({
    where: { id: sourceId }, include: { artist: true },
  });
  if (source.artist.musicbrainzMatchStatus !== 'confirmed' || !source.artist.musicbrainzArtistId) {
    throw new Error('Confirm the artist in MusicBrainz before scanning its YouTube channel.');
  }
  const isInitialSync = source.lastPolledAt === null;
  const videos = await listChannelVideos(source.url);
  const existing = await prisma.musicVideo.findMany({
    where: { artistId: source.artistId }, select: { id: true, youtubeVideoId: true, sourcePublishedAt: true },
  });
  const byYoutubeId = new Map(existing.filter((video) => video.youtubeVideoId)
    .map((video) => [video.youtubeVideoId, video]));
  const reviewRows = await prisma.videoReviewCandidate.findMany({
    where: { source: 'youtube', externalId: { in: videos.map((video) => video.youtubeVideoId) } },
    select: { id: true, externalId: true, title: true, artistName: true, artistId: true, reason: true,
      decision: true, sourcePublishedAt: true },
  });
  const reviewByYoutubeId = new Map(reviewRows.map((row) => [row.externalId, row]));
  let matched = 0;
  let pending = 0;

  for (const video of videos) {
    const catalogVideo = byYoutubeId.get(video.youtubeVideoId);
    if (catalogVideo) {
      if (video.sourcePublishedAt && !catalogVideo.sourcePublishedAt) await prisma.musicVideo.update({
        where: { id: catalogVideo.id }, data: { sourcePublishedAt: video.sourcePublishedAt },
      });
      matched++;
      continue;
    }
    const parsed = parseArtistAndTitle(video.title, source.artist.name);
    const title = parsed.title || video.title;
    const excluded = excludedMusicVideoTitleReason(video.title);
    const artistMatches = normalizeTitle(parsed.artist) === normalizeTitle(source.artist.name);
    const reason = excluded ?? (artistMatches
      ? 'Channel upload needs confirmation as an official song music video.'
      : `Title credits ${parsed.artist}; confirm the artist before adding this video.`);
    const existingReview = reviewByYoutubeId.get(video.youtubeVideoId);
    const newlyKnownDate = video.sourcePublishedAt && !existingReview?.sourcePublishedAt
      ? video.sourcePublishedAt : null;
    if (existingReview?.decision === 'approved' || existingReview?.decision === 'rejected') {
      if (newlyKnownDate) await prisma.videoReviewCandidate.update({
        where: { id: existingReview.id }, data: { sourcePublishedAt: newlyKnownDate },
      });
      if (existingReview.decision === 'approved') {
        if (newlyKnownDate && existingReview.artistId) await prisma.musicVideo.updateMany({
          where: { artistId: existingReview.artistId, normalizedTitle: normalizeTitle(existingReview.title),
            sourcePublishedAt: null },
          data: { sourcePublishedAt: newlyKnownDate },
        });
        matched++;
      }
      continue;
    }
    if (existingReview) {
      const changed = existingReview.title !== title || existingReview.artistName !== parsed.artist
        || existingReview.artistId !== source.artistId || existingReview.reason !== reason
        || Boolean(excluded) || Boolean(newlyKnownDate);
      if (changed) await prisma.videoReviewCandidate.update({
        where: { id: existingReview.id },
        data: { title, artistName: parsed.artist, artistId: source.artistId, reason,
          ...(excluded ? { decision: 'rejected' } : {}),
          ...(newlyKnownDate ? { sourcePublishedAt: newlyKnownDate } : {}) },
      });
      if (!excluded) pending++;
      continue;
    }
    const candidate = await prisma.videoReviewCandidate.create({
      data: {
        source: 'youtube', externalId: video.youtubeVideoId, title,
        artistName: parsed.artist, artistId: source.artistId,
        url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
        decision: excluded ? 'rejected' : 'pending', reason,
        sourcePublishedAt: video.sourcePublishedAt ?? null,
      },
    });
    reviewByYoutubeId.set(video.youtubeVideoId, candidate);
    if (candidate.decision === 'pending') pending++;
  }

  const checkedAt = new Date();
  for (let offset = 0; offset < videos.length; offset += 500) {
    await prisma.videoReviewCandidate.updateMany({
      where: { source: 'youtube', externalId: { in: videos.slice(offset, offset + 500).map((video) => video.youtubeVideoId) } },
      data: { lastSeenAt: checkedAt },
    });
  }
  await prisma.youtubeSource.update({ where: { id: sourceId }, data: { lastPolledAt: checkedAt } });
  return { matched, created: 0, pending, affectedMusicVideoIds: [], isInitialSync };
}

export async function pollAndGrabYoutubeSource(sourceId: number): Promise<YoutubeSyncResult & { grabbed: number }> {
  const result = await syncYoutubeSource(sourceId);
  return { ...result, grabbed: 0 };
}

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
    where: { artistId: source.artistId }, select: { youtubeVideoId: true, normalizedTitle: true },
  });
  const byYoutubeId = new Set(existing.map((video) => video.youtubeVideoId).filter(Boolean));
  let matched = 0;
  let pending = 0;

  for (const video of videos) {
    if (byYoutubeId.has(video.youtubeVideoId)) { matched++; continue; }
    const parsed = parseArtistAndTitle(video.title, source.artist.name);
    const title = parsed.title || video.title;
    const excluded = excludedMusicVideoTitleReason(video.title);
    const artistMatches = normalizeTitle(parsed.artist) === normalizeTitle(source.artist.name);
    const reason = excluded ?? (artistMatches
      ? 'Channel upload needs confirmation as an official song music video.'
      : `Title credits ${parsed.artist}; confirm the artist before adding this video.`);
    const candidate = await prisma.videoReviewCandidate.upsert({
      where: { source_externalId: { source: 'youtube', externalId: video.youtubeVideoId } },
      update: { title, artistName: parsed.artist, artistId: source.artistId, reason },
      create: {
        source: 'youtube', externalId: video.youtubeVideoId, title,
        artistName: parsed.artist, artistId: source.artistId,
        url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
        decision: excluded ? 'rejected' : 'pending', reason,
      },
    });
    if (excluded && candidate.decision === 'pending') {
      await prisma.videoReviewCandidate.updateMany({
        where: { id: candidate.id, decision: 'pending' },
        data: { decision: 'rejected', reason },
      });
    } else if (candidate.decision === 'pending') pending++;
    else if (candidate.decision === 'approved') matched++;
  }

  await prisma.youtubeSource.update({ where: { id: sourceId }, data: { lastPolledAt: new Date() } });
  return { matched, created: 0, pending, affectedMusicVideoIds: [], isInitialSync };
}

export async function pollAndGrabYoutubeSource(sourceId: number): Promise<YoutubeSyncResult & { grabbed: number }> {
  const result = await syncYoutubeSource(sourceId);
  return { ...result, grabbed: 0 };
}

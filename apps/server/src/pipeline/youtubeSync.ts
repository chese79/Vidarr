import { prisma } from '../db/client.js';
import { discoverYoutubeChannel, type DiscoveredYoutubeVideo } from '../providers/youtube/musicDiscovery.js';
import { parseArtistAndTitle } from './bulkImport.js';
import { excludedMusicVideoTitleReason } from './youtubeValidation.js';
import { normalizeTitle } from './normalize.js';
import { assessOfficialYoutubeVideo } from './youtubeOfficial.js';
import { isScanExcluded, loadScanExclusions } from './deletedVideoScans.js';

export interface YoutubeSyncResult {
  matched: number;
  created: number;
  pending: number;
  affectedMusicVideoIds: number[];
  isInitialSync: boolean;
}

// Official category/title evidence automates admission only after identity,
// metadata exclusions and visual validation. Uncertainty remains in Video Review.
export async function syncYoutubeSource(sourceId: number): Promise<YoutubeSyncResult> {
  const source = await prisma.youtubeSource.findUniqueOrThrow({
    where: { id: sourceId }, include: { artist: true },
  });
  if (source.artist.musicbrainzMatchStatus !== 'confirmed' || !source.artist.musicbrainzArtistId) {
    throw new Error('Confirm the artist in MusicBrainz before scanning its YouTube channel.');
  }
  const isInitialSync = source.lastPolledAt === null;
  const discovery = await discoverYoutubeChannel(source.url);
  const videos = discovery.videos;
  const exclusions = await loadScanExclusions(source.artistId);
  const existing = await prisma.musicVideo.findMany({
    where: { artistId: source.artistId }, select: { id: true, youtubeVideoId: true, sourcePublishedAt: true },
  });
  const byYoutubeId = new Map(existing.filter((video) => video.youtubeVideoId)
    .map((video) => [video.youtubeVideoId, video]));
  const reviewRows = [];
  for (let offset = 0; offset < videos.length; offset += 500) reviewRows.push(...await prisma.videoReviewCandidate.findMany({
    where: { source: 'youtube', externalId: { in: videos.slice(offset, offset + 500).map((video) => video.youtubeVideoId) } },
    select: { id: true, externalId: true, title: true, artistName: true, artistId: true, reason: true,
      decision: true, sourcePublishedAt: true },
  }));
  const reviewByYoutubeId = new Map(reviewRows.map((row) => [row.externalId, row]));
  let matched = 0;
  let pending = 0;
  let created = 0;
  const affectedMusicVideoIds: number[] = [];

  for (const video of videos) {
    const parsedForExclusion = parseArtistAndTitle(video.title, source.artist.name);
    if (isScanExcluded(exclusions, source.artistId, { youtubeVideoId: video.youtubeVideoId, title: parsedForExclusion.title })) continue;
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
    let reason = excluded ?? (artistMatches
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
    // Shared channels and mixed playlists must never transfer another artist's review.
    if (existingReview?.artistId && existingReview.artistId !== source.artistId) continue;
    let rejected = Boolean(excluded);
    const conflictingCredit = /^(.{1,100}?)\s+[-–—]\s+/.test(video.title) && !artistMatches;
    if (!excluded && video.officialEvidence.length && !conflictingCredit) {
      const assessment = await assessOfficialYoutubeVideo(video, source.artist.name);
      reason = `${assessment.reason} Evidence: ${video.officialEvidence.join('; ')}. Origins: ${video.discoveryOrigins.join('; ')}.`;
      if (assessment.decision === 'accept' && assessment.songTitle) {
        const saved = await admitOfficialVideo(source.artistId, assessment.songTitle, video, existingReview?.id);
        if (saved) {
          if (saved.created) created++; else matched++;
          affectedMusicVideoIds.push(saved.id);
          continue;
        }
        reason = 'This YouTube video is already assigned to another artist; confirm its credits in Video Review.';
      }
      rejected = assessment.decision === 'reject';
    }
    if (existingReview) {
      const changed = existingReview.title !== title || existingReview.artistName !== parsed.artist
        || existingReview.artistId !== source.artistId || existingReview.reason !== reason
        || rejected || Boolean(newlyKnownDate);
      if (changed) await prisma.videoReviewCandidate.updateMany({
        where: { id: existingReview.id, decision: 'pending', artistId: existingReview.artistId },
        data: { title, artistName: parsed.artist, artistId: source.artistId, reason,
          ...(rejected ? { decision: 'rejected' } : {}),
          ...(newlyKnownDate ? { sourcePublishedAt: newlyKnownDate } : {}) },
      });
      if (!rejected) pending++;
      continue;
    }
    const candidate = await prisma.videoReviewCandidate.upsert({
      where: { source_externalId: { source: 'youtube', externalId: video.youtubeVideoId } }, update: {},
      create: {
        source: 'youtube', externalId: video.youtubeVideoId, title,
        artistName: parsed.artist, artistId: source.artistId,
        url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
        decision: rejected ? 'rejected' : 'pending', reason,
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
  if (discovery.errors.length) throw new Error(`YouTube discovery incomplete: ${discovery.errors.join('; ')}`);
  await prisma.youtubeSource.update({ where: { id: sourceId }, data: { lastPolledAt: checkedAt } });
  return { matched, created, pending, affectedMusicVideoIds, isInitialSync };
}

async function admitOfficialVideo(artistId: number, songTitle: string, video: DiscoveredYoutubeVideo, reviewId?: number) {
  const url = `https://www.youtube.com/watch?v=${video.youtubeVideoId}`;
  return prisma.$transaction(async tx => {
    const owners = await tx.musicVideo.findMany({ where: { OR: [
      { youtubeVideoId: video.youtubeVideoId },
      { acquisitionSources: { some: { provider: 'youtube', OR: [{ externalId: video.youtubeVideoId }, { url }] } } },
    ] } });
    if (owners.some(owner => owner.artistId !== artistId)) return null;
    const owner = owners[0] ?? null;
    const review = await tx.videoReviewCandidate.findUnique({ where: { source_externalId: { source: 'youtube', externalId: video.youtubeVideoId } } });
    if ((reviewId && !review) || (review && (review.decision !== 'pending' || (review.artistId && review.artistId !== artistId)))) return null;
    const publishedAt = review?.sourcePublishedAt ?? video.sourcePublishedAt;
    let title = songTitle;
    let existing = owner;
    for (let version = 2; !existing; version++) {
      const collision = await tx.musicVideo.findUnique({ where: { artistId_normalizedTitle: { artistId, normalizedTitle: normalizeTitle(title) } }, select: { id: true } });
      if (!collision) break;
      // A shared song title does not establish the same official video version,
      // nor ownership of a local file. Only an exact source ID/URL may link above.
      title = `${songTitle} (Version ${version})`;
    }
    const saved = existing ? await tx.musicVideo.update({ where: { id: existing.id }, data: {
      catalogKind: 'official', ...(!existing.youtubeVideoId ? { youtubeVideoId: video.youtubeVideoId } : {}),
      ...(!existing.sourcePublishedAt && publishedAt ? { sourcePublishedAt: publishedAt } : {}),
    } }) : await tx.musicVideo.create({ data: {
      artistId, title, normalizedTitle: normalizeTitle(title), catalogKind: 'official', monitored: false,
      youtubeVideoId: video.youtubeVideoId, sourcePublishedAt: publishedAt,
    } });
    const origin = JSON.stringify({ source: 'youtube-official-discovery', evidence: video.officialEvidence, origins: video.discoveryOrigins });
    const accepted = await tx.acquisitionSource.findUnique({ where: { musicVideoId_provider_url: { musicVideoId: saved.id, provider: 'youtube', url } } });
    await tx.acquisitionSource.upsert({
      where: { musicVideoId_provider_url: { musicVideoId: saved.id, provider: 'youtube', url } },
      update: { accepted: true, confidence: 'confirmed', ...(!accepted ? { discoveryOrigin: origin } : {}) },
      create: { musicVideoId: saved.id, provider: 'youtube', externalId: video.youtubeVideoId, url,
        authority: 'verified', confidence: 'confirmed', accepted: true, discoveryOrigin: origin },
    });
    const reviewData = { artistId, title: saved.title, artistName: (await tx.artist.findUniqueOrThrow({ where: { id: artistId } })).name,
      decision: 'approved', reason: `Automatically confirmed official song music video after identity, metadata and motion checks. ${origin}`,
      sourcePublishedAt: publishedAt };
    await tx.videoReviewCandidate.upsert({ where: { source_externalId: { source: 'youtube', externalId: video.youtubeVideoId } },
      update: reviewData, create: { ...reviewData, source: 'youtube', externalId: video.youtubeVideoId, url } });
    return { id: saved.id, created: !existing };
  });
}

export async function pollAndGrabYoutubeSource(sourceId: number): Promise<YoutubeSyncResult & { grabbed: number }> {
  const result = await syncYoutubeSource(sourceId);
  return { ...result, grabbed: 0 };
}

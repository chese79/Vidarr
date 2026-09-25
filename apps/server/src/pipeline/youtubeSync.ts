import { prisma, logActivity } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { listChannelVideos, getVideoMetadata } from '../providers/youtube/ytdlp.js';
import { grabYoutubeVideo } from './grab.js';
import { classifyCandidate } from './youtubeValidation.js';

export interface YoutubeSyncResult {
  matched: number;
  created: number;
  affectedMusicVideoIds: number[];
  isInitialSync: boolean;
}

// Enumerates a channel/playlist's videos and links them into the artist's
// MusicVideo catalog: an exact normalized-title match against an existing
// (e.g. IMVDb-sourced) record just gets stamped with the youtubeVideoId;
// anything unmatched becomes a new YouTube-native MusicVideo record.
//
// The FIRST sync of a source (lastPolledAt still null) treats the entire
// channel listing as a known baseline, not a wanted list — newly-created
// records are unmonitored, so the scheduled poll job's auto-grab never
// backfills an artist's whole upload history the moment a channel is added.
// Only uploads discovered on a *later* sync (genuinely new since last check)
// are monitored and eligible for auto-grab. A baseline video can still be
// grabbed manually via its own Grab button any time.
export async function syncYoutubeSource(sourceId: number): Promise<YoutubeSyncResult> {
  const source = await prisma.youtubeSource.findUniqueOrThrow({ where: { id: sourceId } });
  const isInitialSync = source.lastPolledAt === null;
  const videos = await listChannelVideos(source.url);
  const existing = await prisma.musicVideo.findMany({ where: { artistId: source.artistId } });
  const byNormalizedTitle = new Map(existing.map((v) => [v.normalizedTitle, v]));
  const byYoutubeId = new Set(existing.map((v) => v.youtubeVideoId).filter(Boolean));

  let matched = 0;
  let created = 0;
  const affectedMusicVideoIds: number[] = [];

  for (const video of videos) {
    if (byYoutubeId.has(video.youtubeVideoId)) continue;

    const normalized = normalizeTitle(video.title);
    const existingMatch = byNormalizedTitle.get(normalized);
    if (existingMatch) {
      await prisma.musicVideo.update({
        where: { id: existingMatch.id },
        data: { youtubeVideoId: video.youtubeVideoId },
      });
      affectedMusicVideoIds.push(existingMatch.id);
      await prisma.acquisitionSource.upsert({
        where: {
          musicVideoId_provider_url: {
            musicVideoId: existingMatch.id,
            provider: 'youtube',
            url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
          },
        },
        update: { externalId: video.youtubeVideoId, accepted: true },
        create: {
          musicVideoId: existingMatch.id,
          provider: 'youtube',
          externalId: video.youtubeVideoId,
          url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
          authority: 'manual',
          confidence: 'confirmed',
          discoveryOrigin: `youtube-source:${sourceId}`,
          accepted: true,
        },
      });
      matched++;
    } else {
      const createdVideo = await prisma.musicVideo.create({
        data: {
          artistId: source.artistId,
          title: video.title,
          normalizedTitle: normalized,
          youtubeVideoId: video.youtubeVideoId,
          monitored: !isInitialSync,
        },
      });
      affectedMusicVideoIds.push(createdVideo.id);
      await prisma.acquisitionSource.create({
        data: {
          musicVideoId: createdVideo.id,
          provider: 'youtube',
          externalId: video.youtubeVideoId,
          url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
          authority: 'manual',
          confidence: 'confirmed',
          discoveryOrigin: `youtube-source:${sourceId}`,
          accepted: true,
        },
      });
      created++;
    }
  }

  await prisma.youtubeSource.update({ where: { id: sourceId }, data: { lastPolledAt: new Date() } });

  return { matched, created, affectedMusicVideoIds, isInitialSync };
}

// Used by the scheduled YouTube poll job: sync, then immediately grab any
// newly-linked video that's still missing a file — the "automatically find
// and grab new music videos from YouTube" behavior. Manual sync via the UI
// intentionally does NOT auto-grab (the user reviews first via the Grab
// button), only the scheduled poll does.
export async function pollAndGrabYoutubeSource(
  sourceId: number,
): Promise<YoutubeSyncResult & { grabbed: number }> {
  const result = await syncYoutubeSource(sourceId);
  const candidates = await prisma.musicVideo.findMany({
    where: { id: { in: result.affectedMusicVideoIds }, hasFile: false, monitored: true },
  });

  let grabbed = 0;
  for (const video of candidates) {
    if (!video.youtubeVideoId) continue;
    try {
      // Metadata-only check — no bounded sample-clip download here. Unlike
      // autoSearchAndGrab's autonomous broad search, this channel is one the
      // user already configured as this specific artist's own source, so
      // only the strong content-type negatives (Topic channel, lyric video,
      // etc.) are worth rejecting on; an inconclusive 'review' proceeds
      // rather than adding friction to an already-trusted channel. The
      // existing post-download assertIsRealMusicVideo (via grabYoutubeVideo)
      // remains the safety net either way.
      const classification = classifyCandidate(await getVideoMetadata(video.youtubeVideoId));
      if (classification.decision === 'reject') {
        await prisma.history.create({
          data: {
            musicVideoId: video.id,
            eventType: 'candidateRejected',
            data: JSON.stringify({
              source: 'youtube',
              youtubeVideoId: video.youtubeVideoId,
              title: video.title,
              reason: classification.reason,
            }),
          },
        });
        continue;
      }
      await grabYoutubeVideo(video.id);
      grabbed++;
    } catch (err) {
      await logActivity('warn', 'youtube-poll', err);
    }
  }

  return { ...result, grabbed };
}

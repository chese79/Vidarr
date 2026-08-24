import { prisma } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { listChannelVideos } from '../providers/youtube/ytdlp.js';
import { grabYoutubeVideo } from './grab.js';

export interface YoutubeSyncResult {
  matched: number;
  created: number;
  affectedMusicVideoIds: number[];
}

// Enumerates a channel/playlist's videos and links them into the artist's
// MusicVideo catalog: an exact normalized-title match against an existing
// (e.g. IMVDb-sourced) record just gets stamped with the youtubeVideoId;
// anything unmatched becomes a new YouTube-native MusicVideo record.
export async function syncYoutubeSource(sourceId: number): Promise<YoutubeSyncResult> {
  const source = await prisma.youtubeSource.findUniqueOrThrow({ where: { id: sourceId } });
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
      matched++;
    } else {
      const createdVideo = await prisma.musicVideo.create({
        data: {
          artistId: source.artistId,
          title: video.title,
          normalizedTitle: normalized,
          youtubeVideoId: video.youtubeVideoId,
          monitored: true,
        },
      });
      affectedMusicVideoIds.push(createdVideo.id);
      created++;
    }
  }

  await prisma.youtubeSource.update({ where: { id: sourceId }, data: { lastPolledAt: new Date() } });

  return { matched, created, affectedMusicVideoIds };
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
    try {
      await grabYoutubeVideo(video.id);
      grabbed++;
    } catch (err) {
      await prisma.activityLog.create({
        data: { level: 'warn', source: 'youtube-poll', message: (err as Error).message },
      });
    }
  }

  return { ...result, grabbed };
}

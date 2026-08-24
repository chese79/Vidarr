import { prisma } from '../db/client.js';
import { searchAllIndexers } from './search.js';
import { grabFromIndexer } from './grab.js';

export interface AutoSearchOutcome {
  musicVideoId: number;
  grabbed: boolean;
  reason: string;
}

// Picks the best release for a video and grabs it automatically. "Best" =
// highest quality allowed by the artist's quality profile, then most seeders.
// `minWeight` (default: none) restricts results to strictly better than a
// given quality weight — used by the quality-upgrade job so it never
// "upgrades" to something no better than what's already on disk. No download
// client configured, or no qualifying result, is a normal outcome, not an
// error.
export async function autoSearchAndGrab(
  musicVideoId: number,
  minWeight = -1,
): Promise<AutoSearchOutcome> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({
    where: { id: musicVideoId },
    include: {
      artist: {
        include: { qualityProfile: { include: { items: { include: { quality: true } } } } },
      },
    },
  });

  const downloadClient = await prisma.downloadClient.findFirst({
    where: { enabled: true },
    orderBy: { priority: 'asc' },
  });
  if (!downloadClient) {
    return { musicVideoId, grabbed: false, reason: 'No enabled download client configured' };
  }

  const allowedQualities = new Map(
    musicVideo.artist.qualityProfile.items
      .filter((i) => i.allowed && i.quality.weight > minWeight)
      .map((i) => [i.quality.name, i.quality.weight]),
  );
  if (!allowedQualities.size) {
    return { musicVideoId, grabbed: false, reason: 'Quality profile allows no qualities' };
  }

  const results = await searchAllIndexers(`${musicVideo.artist.name} ${musicVideo.title}`);
  const eligible = results.filter((r) => allowedQualities.has(r.quality));
  if (!eligible.length) {
    return { musicVideoId, grabbed: false, reason: 'No results in an allowed quality' };
  }

  const best = eligible.reduce((a, b) => {
    const weightDiff = (allowedQualities.get(b.quality) ?? 0) - (allowedQualities.get(a.quality) ?? 0);
    if (weightDiff !== 0) return weightDiff > 0 ? b : a;
    return (b.seeders ?? 0) > (a.seeders ?? 0) ? b : a;
  });

  await grabFromIndexer(musicVideoId, downloadClient.id, best.downloadUrl, best.quality);
  return { musicVideoId, grabbed: true, reason: `Grabbed ${best.quality} from ${best.indexerName}` };
}

export async function runBacklogSearch(): Promise<{ grabbed: number; skipped: number }> {
  const wanted = await prisma.musicVideo.findMany({
    where: { monitored: true, hasFile: false },
    select: { id: true },
  });

  let grabbed = 0;
  let skipped = 0;
  for (const video of wanted) {
    try {
      const outcome = await autoSearchAndGrab(video.id);
      if (outcome.grabbed) grabbed++;
      else skipped++;
    } catch (err) {
      skipped++;
      await prisma.activityLog.create({
        data: { level: 'warn', source: 'backlog-search', message: (err as Error).message },
      });
    }
  }
  return { grabbed, skipped };
}

// "Upgrade until cutoff": an owned file below its profile's cutoff quality is
// eligible for a better release. Once a video reaches (or already exceeds)
// the cutoff, it stops being searched — matches Sonarr/Radarr's own upgrade
// semantics (the cutoff is a ceiling on ongoing upgrade effort, not just a
// floor for the initial grab).
export async function runQualityUpgradeSearch(): Promise<{ upgraded: number; skipped: number }> {
  const filesBelowCutoff = await prisma.musicVideoFile.findMany({
    include: {
      quality: true,
      musicVideo: {
        include: { artist: { include: { qualityProfile: true } } },
      },
    },
  });

  let upgraded = 0;
  let skipped = 0;
  const cutoffWeightByProfile = new Map<number, number | undefined>();

  for (const file of filesBelowCutoff) {
    const profileId = file.musicVideo.artist.qualityProfile.id;
    if (!cutoffWeightByProfile.has(profileId)) {
      const cutoffQuality = await prisma.quality.findUnique({
        where: { id: file.musicVideo.artist.qualityProfile.cutoffQualityId },
      });
      cutoffWeightByProfile.set(profileId, cutoffQuality?.weight);
    }
    const cutoffWeight = cutoffWeightByProfile.get(profileId);
    const currentWeight = file.quality?.weight ?? 0;
    if (cutoffWeight === undefined || currentWeight >= cutoffWeight) {
      skipped++;
      continue;
    }

    try {
      const outcome = await autoSearchAndGrab(file.musicVideoId, currentWeight);
      if (outcome.grabbed) upgraded++;
      else skipped++;
    } catch (err) {
      skipped++;
      await prisma.activityLog.create({
        data: { level: 'warn', source: 'quality-upgrade', message: (err as Error).message },
      });
    }
  }

  return { upgraded, skipped };
}

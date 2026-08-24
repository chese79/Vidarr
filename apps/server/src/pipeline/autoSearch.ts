import { prisma } from '../db/client.js';
import { searchAllIndexers } from './search.js';
import { grabFromIndexer } from './grab.js';

export interface AutoSearchOutcome {
  musicVideoId: number;
  grabbed: boolean;
  reason: string;
}

// Picks the best release for a wanted video and grabs it automatically — the
// "missing/wanted backlog search" behavior. "Best" = highest quality allowed by
// the artist's quality profile, then most seeders. No download client
// configured, or no result in an allowed quality, is a normal outcome here,
// not an error.
export async function autoSearchAndGrab(musicVideoId: number): Promise<AutoSearchOutcome> {
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
      .filter((i) => i.allowed)
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

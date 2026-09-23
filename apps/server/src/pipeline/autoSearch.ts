import { prisma, logActivity } from '../db/client.js';
import { searchAllIndexers } from './search.js';
import { grabFromIndexer, grabYoutubeVideo } from './grab.js';
import { findYoutubeMatch } from './youtubeMatch.js';
import { hasActiveDownload } from './videoStatus.js';
import { validateCandidate, type ClassificationResult } from './youtubeValidation.js';

export interface AutoSearchOutcome {
  musicVideoId: number;
  grabbed: boolean;
  reason: string;
}

// A rejected/held candidate previously vanished with no trace at all — this
// is what the request doc means by "every candidate is accepted, rejected
// with a reason, or held for manual review": reusing History (rather than a
// new "AcquisitionSource" table — see the Phase 3 plan) so the decision is
// at least visible on the existing History page, not silently dropped.
async function recordCandidateDecision(
  musicVideoId: number,
  youtubeVideoId: string,
  title: string,
  result: ClassificationResult,
): Promise<void> {
  await prisma.history.create({
    data: {
      musicVideoId,
      eventType: result.decision === 'reject' ? 'candidateRejected' : 'candidateHeldForReview',
      data: JSON.stringify({ source: 'youtube', youtubeVideoId, title, reason: result.reason }),
    },
  });
}

// Picks the best release for a video and grabs it automatically. YouTube is
// tried first when allowed by the quality profile: official/VEVO uploads are
// far more reliably *the right specific video* than a Newznab text search,
// which for short/common song titles ("Stand", "Blue") will always have
// precision problems even scoped to the right category (see
// pipeline/youtubeMatch.ts for the matching heuristic). Indexer search is the
// fallback when YouTube has no confident match, or when the profile doesn't
// allow the YouTube quality tier at all. `minWeight` (default: none)
// restricts results to strictly better than a given quality weight — used by
// the quality-upgrade job so it never "upgrades" to something no better than
// what's already on disk. No qualifying result anywhere is a normal outcome,
// not an error.
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

  // These two checks apply no matter which caller reached this function
  // (backlog search, quality upgrade, or a manual "search selected" bulk
  // action) — unlike "owned by a monitored artist" or "already missing",
  // which mean different things depending on the caller (a quality-upgrade
  // candidate is *expected* to already have a file, for instance) and so are
  // filtered by each caller's own candidate query instead of here.
  if (musicVideo.ignored) {
    return { musicVideoId, grabbed: false, reason: 'Video is ignored' };
  }
  if (await hasActiveDownload(musicVideoId)) {
    return { musicVideoId, grabbed: false, reason: 'Already downloading' };
  }

  const allowedQualities = new Map(
    musicVideo.artist.qualityProfile.items
      .filter((i) => i.allowed && i.quality.weight > minWeight)
      .map((i) => [i.quality.name, i.quality.weight]),
  );
  if (!allowedQualities.size) {
    return { musicVideoId, grabbed: false, reason: 'Quality profile allows no qualities' };
  }

  if (allowedQualities.has('YouTube')) {
    // An IMVDb-sourced youtubeVideoId (see providers/metadata/imvdb.ts
    // getVideoDetails) is an editor-curated, exact match — a strictly better
    // source than our own heuristic search, so grab it directly and skip the
    // search entirely when we already have it. This is the request doc's own
    // carve-out ("Accept these automatically only when IMVDb explicitly
    // identifies the exact item as the official video") — deliberately the
    // only bypass of content-type validation; see the heuristic-match branch
    // below, where a VEVO-tier result does NOT get the same bypass, since a
    // heuristic search match (even from a VEVO-named channel) is not an
    // IMVDb identification.
    if (musicVideo.youtubeVideoId) {
      try {
        await grabYoutubeVideo(musicVideoId);
        return {
          musicVideoId,
          grabbed: true,
          reason: `Grabbed via IMVDb-sourced YouTube link (${musicVideo.title})`,
        };
      } catch (err) {
        await logActivity('warn', 'auto-search-youtube', err);
        // fall through to heuristic search / indexer search below
      }
    }

    try {
      const match = await findYoutubeMatch(musicVideo.artist.name, musicVideo.title);
      if (match) {
        // Every heuristic-search candidate is validated, VEVO tier included:
        // youtubeMatch.ts's isVevo is a bare channel-name substring check
        // ("vevo" appearing in the channel name), not a verified-channel or
        // IMVDb signal, so it's spoofable and cannot bypass content-type
        // classification on its own — the request doc lists "verified
        // official/VEVO uploader" as a *positive signal* for scoring, not as
        // grounds for an automatic accept (only an IMVDb-explicit match gets
        // that, handled above). A verified uploader remains a strong positive
        // signal, but still receives the bounded motion check so an unlabeled
        // static-art upload cannot slip through.
        const validation: ClassificationResult = await validateCandidate(
          match.candidate.youtubeVideoId,
          musicVideo.title,
        );

        if (validation.decision === 'accept') {
          await prisma.musicVideo.update({
            where: { id: musicVideoId },
            data: { youtubeVideoId: match.candidate.youtubeVideoId },
          });
          await grabYoutubeVideo(musicVideoId);
          const sourceLabel = match.tier === 'vevo' ? 'VEVO' : 'YouTube';
          return {
            musicVideoId,
            grabbed: true,
            reason: `Grabbed via ${sourceLabel} (${match.candidate.title})`,
          };
        }

        await recordCandidateDecision(musicVideoId, match.candidate.youtubeVideoId, match.candidate.title, validation);
        // fall through to indexer search below — a rejected/held YouTube
        // candidate doesn't stop the search, it just isn't grabbed from here.
      }
    } catch (err) {
      await logActivity('warn', 'auto-search-youtube', err);
      // fall through to indexer search below
    }
  }

  const downloadClient = await prisma.downloadClient.findFirst({
    where: { enabled: true },
    orderBy: { priority: 'asc' },
  });
  if (!downloadClient) {
    return { musicVideoId, grabbed: false, reason: 'No YouTube match and no download client configured' };
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

// The full "eligible for automatic search" gate — narrower than
// autoSearchAndGrab's own ignored/active-download checks, since this is the
// one caller where "owned by a monitored artist" and "not already available
// anywhere" actually apply (a manual bulk-search or a quality-upgrade
// candidate legitimately has a file already, so those checks live only
// here, not inside the shared grab function).
export async function runBacklogSearch(): Promise<{ grabbed: number; skipped: number }> {
  const wanted = await prisma.musicVideo.findMany({
    where: {
      monitored: true,
      ignored: false,
      hasFile: false,
      artist: { monitored: true },
      // Excludes a video only for a CONFIRMED library match — matchConfidence
      // null means an exact-key match or one a human has since confirmed via
      // the review UI. A probable/ambiguous fuzzy suggestion must not block
      // backlog search on its own; see videoStatus.ts's computeVideoStatus
      // for the same rule applied to the Artist Detail page. Also requires
      // the match's connector still be enabled — a disabled connector's
      // stale last-synced rows must not suppress search either.
      libraryVideos: { none: { available: true, matchConfidence: null, connector: { enabled: true } } },
      queueItems: { none: { status: { in: ['queued', 'downloading', 'submissionUnknown'] } } },
    },
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
      await logActivity('warn', 'backlog-search', err);
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
      await logActivity('warn', 'quality-upgrade', err);
    }
  }

  return { upgraded, skipped };
}

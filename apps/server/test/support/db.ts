import { prisma } from '../../src/db/client.js';

// Deletes every row, children before parents, so foreign keys never block a
// delete regardless of whether SQLite FK enforcement is on. Call from a
// beforeEach in any DB-backed test file so tests don't see each other's rows
// (tests share one on-disk SQLite file — see vitest.config.ts).
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.metadataEnrichmentItem.deleteMany(),
    prisma.metadataEnrichmentRun.deleteMany(),
    prisma.liveDiscoveryItem.deleteMany(),
    prisma.playlistItem.deleteMany(),
    prisma.liveSongViewing.deleteMany(),
    prisma.livePlaybackObservation.deleteMany(),
    prisma.liveViewing.deleteMany(),
    prisma.recordingCoverage.deleteMany(),
    prisma.recordingServerCopy.deleteMany(),
    prisma.recordingPart.deleteMany(),
    prisma.recordingSource.deleteMany(),
    prisma.liveCredit.deleteMany(),
    prisma.liveMonitoringRule.deleteMany(),
    prisma.liveSearchJournal.deleteMany(),
    prisma.liveRequestBudget.deleteMany(),
    prisma.liveExclusion.deleteMany(),
    prisma.liveConfiguration.deleteMany(),
    prisma.history.deleteMany(),
    prisma.downloadQueueItem.deleteMany(),
    prisma.recordingPerformance.deleteMany(),
    prisma.recording.deleteMany(),
    prisma.liveSongPerformance.deleteMany(),
    prisma.livePerformance.deleteMany(),
    prisma.liveOccasion.deleteMany(),
    prisma.qualifiedPlayback.deleteMany(),
    prisma.deletedVideoRecord.deleteMany(),
    prisma.lastFmPlayback.deleteMany(),
    prisma.lastFmAccount.deleteMany(),
    prisma.videoReviewCandidate.deleteMany(),
    prisma.recommendationSourceHit.deleteMany(),
    prisma.recommendation.deleteMany(),
    prisma.recommendationProviderConfig.deleteMany(),
    prisma.playlistSync.deleteMany(),
    prisma.playlist.deleteMany(),
    prisma.libraryVideo.deleteMany(),
    prisma.libraryRecording.deleteMany(),
    prisma.libraryArtist.deleteMany(),
    prisma.libraryConnector.deleteMany(),
    prisma.musicVideoFile.deleteMany(),
    prisma.musicVideo.deleteMany(),
    prisma.youtubeSource.deleteMany(),
    prisma.artistGenre.deleteMany(),
    prisma.artist.deleteMany(),
    prisma.qualityProfileItem.deleteMany(),
    prisma.qualityProfile.deleteMany(),
    prisma.quality.deleteMany(),
    prisma.rootFolder.deleteMany(),
    prisma.indexer.deleteMany(),
    prisma.downloadClient.deleteMany(),
    prisma.activityLog.deleteMany(),
    prisma.scheduledTask.deleteMany(),
    prisma.settings.deleteMany(),
  ]);
}

export async function createRootFolder(overrides: Partial<{ path: string }> = {}) {
  return prisma.rootFolder.create({
    data: { path: overrides.path ?? '/media/test-root' },
  });
}

export async function createQuality(overrides: Partial<{ name: string; weight: number }> = {}) {
  return prisma.quality.create({
    data: {
      name: overrides.name ?? '1080p',
      source: 'web',
      resolution: 1080,
      weight: overrides.weight ?? 30,
    },
  });
}

export async function createQualityProfile(cutoffQualityId: number, overrides: Partial<{ name: string }> = {}) {
  return prisma.qualityProfile.create({
    data: { name: overrides.name ?? 'Test Profile', cutoffQualityId },
  });
}

export async function createArtist(
  rootFolderId: number,
  qualityProfileId: number,
  overrides: Partial<{ name: string; sortName: string; genre: string | null; monitored: boolean }> = {},
) {
  // Defaults to monitored: true here — a deliberate, explicit test-fixture
  // default independent of the production API's own default (which is
  // false, see schema.prisma's comment on Artist.monitored). Most existing
  // tests building a fixture via this helper are testing monitored-artist
  // behavior (search eligibility, backlog jobs, etc.) and would otherwise
  // silently break if this helper's default changed along with production's.
  return prisma.artist.create({
    data: {
      name: overrides.name ?? 'Test Artist',
      sortName: overrides.sortName ?? overrides.name ?? 'Test Artist',
      rootFolderId,
      qualityProfileId,
      genre: overrides.genre ?? null,
      monitored: overrides.monitored ?? true,
    },
  });
}

export async function createMusicVideo(
  artistId: number,
  overrides: Partial<{
    title: string;
    normalizedTitle: string;
    releaseYear: number | null;
    genre: string | null;
    hasFile: boolean;
    monitored: boolean;
    ignored: boolean;
    youtubeVideoId: string | null;
  }> = {},
) {
  return prisma.musicVideo.create({
    data: {
      artistId,
      title: overrides.title ?? 'Test Video',
      normalizedTitle: overrides.normalizedTitle ?? (overrides.title ?? 'Test Video').toLowerCase(),
      releaseYear: overrides.releaseYear ?? null,
      genre: overrides.genre ?? null,
      hasFile: overrides.hasFile ?? false,
      monitored: overrides.monitored ?? true,
      ignored: overrides.ignored ?? false,
      youtubeVideoId: overrides.youtubeVideoId ?? null,
    },
  });
}

export async function createMusicVideoFile(
  musicVideoId: number,
  overrides: Partial<{ path: string; playCount: number | null }> = {},
) {
  return prisma.musicVideoFile.create({
    data: {
      musicVideoId,
      path: overrides.path ?? '/media/test-root/Test Artist/Test Artist - Test Video.mp4',
      sizeBytes: 1024n,
      originalFilename: 'source.mp4',
      playCount: overrides.playCount ?? null,
    },
  });
}

export async function createLibraryConnector(
  overrides: Partial<{ name: string; type: string; host: string; enabled: boolean }> = {},
) {
  return prisma.libraryConnector.create({
    data: {
      name: overrides.name ?? 'Test Connector',
      type: overrides.type ?? 'jellyfin',
      host: overrides.host ?? 'http://jellyfin.local:8096',
      enabled: overrides.enabled ?? true,
    },
  });
}

export async function createLibraryVideo(
  connectorId: number,
  overrides: Partial<{
    externalId: string;
    title: string;
    artistName: string;
    normalizedArtistName: string;
    normalizedTitle: string;
    playCount: number | null;
    available: boolean;
    musicVideoId: number | null;
    matchConfidence: string | null;
  }> = {},
) {
  return prisma.libraryVideo.create({
    data: {
      connectorId,
      externalId: overrides.externalId ?? 'ext-video-1',
      title: overrides.title ?? 'Test Video',
      normalizedTitle: overrides.normalizedTitle ?? (overrides.title ?? 'Test Video').toLowerCase(),
      artistName: overrides.artistName ?? 'Test Artist',
      normalizedArtistName: overrides.normalizedArtistName ?? (overrides.artistName ?? 'Test Artist').toLowerCase(),
      playCount: overrides.playCount ?? null,
      available: overrides.available ?? true,
      musicVideoId: overrides.musicVideoId ?? null,
      matchConfidence: overrides.matchConfidence ?? null,
    },
  });
}

export async function createRecommendationProviderConfig(
  overrides: Partial<{ provider: string; enabled: boolean }> = {},
) {
  return prisma.recommendationProviderConfig.create({
    data: {
      provider: overrides.provider ?? 'lastfm',
      enabled: overrides.enabled ?? false,
    },
  });
}

export async function createRecommendation(
  overrides: Partial<{ artistName: string; normalizedArtistName: string; aggregateScore: number; dismissed: boolean }> = {},
) {
  return prisma.recommendation.create({
    data: {
      artistName: overrides.artistName ?? 'Recommended Artist',
      normalizedArtistName: overrides.normalizedArtistName ?? (overrides.artistName ?? 'Recommended Artist').toLowerCase(),
      aggregateScore: overrides.aggregateScore ?? 1.0,
      dismissed: overrides.dismissed ?? false,
    },
  });
}

export async function ensureSettings(overrides: Partial<{ apiKey: string | null }> = {}) {
  return prisma.settings.upsert({
    where: { id: 1 },
    update: overrides,
    create: { id: 1, apiKey: overrides.apiKey ?? null },
  });
}

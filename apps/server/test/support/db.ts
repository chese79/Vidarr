import { prisma } from '../../src/db/client.js';

// Deletes every row, children before parents, so foreign keys never block a
// delete regardless of whether SQLite FK enforcement is on. Call from a
// beforeEach in any DB-backed test file so tests don't see each other's rows
// (tests share one on-disk SQLite file — see vitest.config.ts).
export async function resetDb(): Promise<void> {
  await prisma.recommendationSourceHit.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.recommendationProviderConfig.deleteMany();
  await prisma.playlistSync.deleteMany();
  await prisma.playlistItem.deleteMany();
  await prisma.playlist.deleteMany();
  await prisma.libraryArtist.deleteMany();
  await prisma.libraryConnector.deleteMany();
  await prisma.history.deleteMany();
  await prisma.downloadQueueItem.deleteMany();
  await prisma.musicVideoFile.deleteMany();
  await prisma.musicVideo.deleteMany();
  await prisma.youtubeSource.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.qualityProfileItem.deleteMany();
  await prisma.qualityProfile.deleteMany();
  await prisma.quality.deleteMany();
  await prisma.rootFolder.deleteMany();
  await prisma.indexer.deleteMany();
  await prisma.downloadClient.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.scheduledTask.deleteMany();
  await prisma.settings.deleteMany();
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
  overrides: Partial<{ name: string; sortName: string; genre: string | null }> = {},
) {
  return prisma.artist.create({
    data: {
      name: overrides.name ?? 'Test Artist',
      sortName: overrides.sortName ?? overrides.name ?? 'Test Artist',
      rootFolderId,
      qualityProfileId,
      genre: overrides.genre ?? null,
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

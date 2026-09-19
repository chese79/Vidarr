import { prisma, logActivity } from '../db/client.js';
import { normalizeTitle } from './normalize.js';
import { createLastFmProvider } from '../providers/recommendation/lastfm.js';
import { createMusicBrainzProvider } from '../providers/recommendation/musicbrainz.js';
import { createSpotifyProvider } from '../providers/recommendation/spotify.js';
import type { RecommendationProvider, SimilarArtistHit } from '../providers/recommendation/types.js';

const SEED_CAP = 50;

const SOURCE_WEIGHT: Record<string, number> = {
  library: 1.0,
  lastfm: 0.5,
  spotify: 0.35,
  musicbrainz: 0.15,
};

interface PendingHit {
  source: string;
  sourceRef?: string;
  seedArtistName: string;
  score: number;
  reason: string;
}

interface PendingRecommendation {
  artistName: string;
  normalizedArtistName: string;
  mbid?: string;
  hits: PendingHit[];
}

async function buildSeedSet(): Promise<{ seedNames: string[]; excludedNormalized: Set<string> }> {
  const artists = await prisma.artist.findMany({ select: { name: true } });
  const excludedNormalized = new Set(artists.map((a) => normalizeTitle(a.name)));

  const libraryArtists = await prisma.libraryArtist.findMany({
    where: { connector: { enabled: true } },
    orderBy: [{ playCount: 'desc' }, { lastSyncedAt: 'desc' }],
    select: { name: true },
  });
  const libraryVideoArtists = await prisma.libraryVideo.findMany({
    where: { available: true, connector: { enabled: true } },
    select: { artistName: true },
  });

  const seedNames: string[] = [];
  const seen = new Set<string>();
  for (const name of [
    ...artists.map((a) => a.name),
    ...libraryArtists.map((a) => a.name),
    ...libraryVideoArtists.map((a) => a.artistName),
  ]) {
    const norm = normalizeTitle(name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    seedNames.push(name);
    if (seedNames.length >= SEED_CAP) break;
  }

  return { seedNames, excludedNormalized };
}

function upsertPending(
  map: Map<string, PendingRecommendation>,
  name: string,
  hit: PendingHit,
  mbid?: string,
) {
  const normalized = normalizeTitle(name);
  if (!normalized) return;
  let entry = map.get(normalized);
  if (!entry) {
    entry = { artistName: name, normalizedArtistName: normalized, mbid, hits: [] };
    map.set(normalized, entry);
  }
  entry.hits.push(hit);
}

export async function getEnabledProviders(): Promise<{ name: string; provider: RecommendationProvider }[]> {
  const configs = await prisma.recommendationProviderConfig.findMany({ where: { enabled: true } });
  const providers: { name: string; provider: RecommendationProvider }[] = [];

  for (const config of configs) {
    if (config.provider === 'lastfm' && config.apiKey) {
      providers.push({ name: 'lastfm', provider: createLastFmProvider(config.apiKey) });
    } else if (config.provider === 'musicbrainz') {
      providers.push({ name: 'musicbrainz', provider: createMusicBrainzProvider() });
    } else if (config.provider === 'spotify' && config.clientId && config.clientSecret) {
      providers.push({
        name: 'spotify',
        provider: createSpotifyProvider(
          {
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            tokenState: { accessToken: config.accessToken, expiresAt: config.tokenExpiresAt },
          },
          async (accessToken, expiresAt) => {
            await prisma.recommendationProviderConfig.update({
              where: { provider: 'spotify' },
              data: { accessToken, tokenExpiresAt: expiresAt },
            });
          },
        ),
      });
    }
  }

  return providers;
}

export async function refreshRecommendations(): Promise<{
  totalRecommendations: number;
  newRecommendations: number;
}> {
  const { seedNames, excludedNormalized } = await buildSeedSet();
  const pending = new Map<string, PendingRecommendation>();

  const libraryArtists = await prisma.libraryArtist.findMany({
    where: { connector: { enabled: true } },
  });
  for (const la of libraryArtists) {
    if (excludedNormalized.has(normalizeTitle(la.name))) continue;
    upsertPending(pending, la.name, {
      source: 'library',
      seedArtistName: la.name,
      score: 1,
      reason: 'You listen to this artist',
    });
  }
  const libraryVideos = await prisma.libraryVideo.findMany({
    where: { available: true, connector: { enabled: true } },
  });
  const seenVideoArtists = new Set<string>();
  for (const video of libraryVideos) {
    const normalizedArtist = normalizeTitle(video.artistName);
    if (excludedNormalized.has(normalizedArtist) || seenVideoArtists.has(normalizedArtist)) continue;
    seenVideoArtists.add(normalizedArtist);
    upsertPending(pending, video.artistName, {
      source: 'library',
      sourceRef: `video:${video.connectorId}:${video.externalId}`,
      seedArtistName: video.artistName,
      score: 1,
      reason: 'You have a music video by this artist',
    });
  }

  const providers = await getEnabledProviders();
  for (const { name, provider } of providers) {
    let hits: SimilarArtistHit[] = [];
    try {
      hits = await provider.getSimilarArtists(seedNames);
    } catch (err) {
      await logActivity('warn', `recommendation:${name}`, err);
      continue;
    }
    for (const hit of hits) {
      const normalized = normalizeTitle(hit.name);
      if (excludedNormalized.has(normalized)) continue;
      if (seedNames.some((s) => normalizeTitle(s) === normalized)) continue;
      upsertPending(pending, hit.name, {
        source: name,
        sourceRef: hit.sourceRef,
        seedArtistName: hit.seedArtistName,
        score: hit.score,
        reason: hit.reason,
      });
    }
  }

  const entries = [...pending.values()];
  const existingNames = new Set((await prisma.recommendation.findMany({
    select: { normalizedArtistName: true },
  })).map((item) => item.normalizedArtistName));
  const newCount = entries.filter((entry) => !existingNames.has(entry.normalizedArtistName)).length;
  const recommendations = await prisma.$transaction(entries.map((entry) => {
    const aggregateScore = entry.hits.reduce(
      (sum, hit) => sum + hit.score * (SOURCE_WEIGHT[hit.source] ?? 0),
      0,
    );
    return prisma.recommendation.upsert({
      where: { normalizedArtistName: entry.normalizedArtistName },
      update: { aggregateScore, lastSeenAt: new Date() },
      create: {
        artistName: entry.artistName,
        normalizedArtistName: entry.normalizedArtistName,
        mbid: entry.mbid,
        aggregateScore,
      },
    });
  }));
  const recommendationIds = recommendations.map((item) => item.id);
  if (recommendationIds.length) {
    await prisma.recommendationSourceHit.deleteMany({
      where: { recommendationId: { in: recommendationIds } },
    });
    await prisma.recommendationSourceHit.createMany({
      data: entries.flatMap((entry, index) => entry.hits.map((hit) => ({
        recommendationId: recommendations[index].id,
        source: hit.source,
        sourceRef: hit.sourceRef,
        seedArtistName: hit.seedArtistName,
        score: hit.score,
        reason: hit.reason,
      }))),
    });
  }

  return { totalRecommendations: pending.size, newRecommendations: newCount };
}

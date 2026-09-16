import { prisma } from '../db/client.js';

// Baseline data every install needs to actually use the app — without at
// least one QualityProfile, the "Add Artist" flow has nothing to put in its
// Quality Profile dropdown. Previously this only existed via a separate,
// manual `npm run prisma:seed` step (still fine for local dev), but the
// Docker image's own startup (`prisma migrate deploy && node dist/main.js`)
// never ran it — so every Docker install silently had zero Quality/
// QualityProfile/RecommendationProviderConfig rows until someone thought to
// exec in and seed by hand. Idempotent (upsert-by-unique-name), so it's safe
// to call on every boot the same way ensureApiKey() already is — this is
// exactly that same "self-healing on startup" pattern, just for data instead
// of the API key.
const DEFAULT_QUALITIES = [
  { name: 'SD', source: 'unknown', resolution: 480, weight: 1 },
  { name: '720p', source: 'web', resolution: 720, weight: 2 },
  { name: '1080p', source: 'web', resolution: 1080, weight: 3 },
  { name: '2160p', source: 'web', resolution: 2160, weight: 4 },
  { name: 'YouTube', source: 'youtube', resolution: null, weight: 2 },
] as const;

export async function ensureDefaultData(): Promise<void> {
  const qualities = [];
  for (const q of DEFAULT_QUALITIES) {
    qualities.push(await prisma.quality.upsert({ where: { name: q.name }, update: {}, create: q }));
  }

  const cutoff = qualities.find((q) => q.name === '1080p')!;
  await prisma.qualityProfile.upsert({
    where: { name: 'Any' },
    update: {},
    create: {
      name: 'Any',
      cutoffQualityId: cutoff.id,
      items: { create: qualities.map((q) => ({ qualityId: q.id, allowed: true })) },
    },
  });

  for (const provider of ['lastfm', 'spotify', 'musicbrainz']) {
    await prisma.recommendationProviderConfig.upsert({ where: { provider }, update: {}, create: { provider } });
  }
}

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_QUALITIES = [
  { name: 'SD', source: 'unknown', resolution: 480, weight: 1 },
  { name: '720p', source: 'web', resolution: 720, weight: 2 },
  { name: '1080p', source: 'web', resolution: 1080, weight: 3 },
  { name: '2160p', source: 'web', resolution: 2160, weight: 4 },
  { name: 'YouTube', source: 'youtube', resolution: null, weight: 2 },
];

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const qualities = [];
  for (const q of DEFAULT_QUALITIES) {
    qualities.push(
      await prisma.quality.upsert({
        where: { name: q.name },
        update: {},
        create: q,
      }),
    );
  }

  const cutoff = qualities.find((q) => q.name === '1080p')!;

  await prisma.qualityProfile.upsert({
    where: { name: 'Any' },
    update: {},
    create: {
      name: 'Any',
      cutoffQualityId: cutoff.id,
      items: {
        create: qualities.map((q) => ({ qualityId: q.id, allowed: true })),
      },
    },
  });

  for (const provider of ['lastfm', 'spotify', 'musicbrainz']) {
    await prisma.recommendationProviderConfig.upsert({
      where: { provider },
      update: {},
      create: { provider },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

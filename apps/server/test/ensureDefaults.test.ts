import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/db/client.js';
import { ensureDefaultData } from '../src/pipeline/ensureDefaults.js';
import { resetDb } from './support/db.js';

// Runs on every server boot (see main.ts) — the Docker image's own startup
// (`prisma migrate deploy && node dist/main.js`) never ran the old, separate
// `npm run prisma:seed` script, so a Docker install had zero Quality/
// QualityProfile rows until someone thought to seed by hand: the "Add
// Artist" Quality Profile dropdown had nothing to show. This must be
// idempotent since it runs on *every* boot, not just the first.
describe('ensureDefaultData', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates the default qualities, an "Any" quality profile, and the three recommendation providers', async () => {
    await ensureDefaultData();

    const qualities = await prisma.quality.findMany();
    expect(qualities.map((q) => q.name).sort()).toEqual(['1080p', '2160p', '720p', 'SD', 'YouTube'].sort());

    const profile = await prisma.qualityProfile.findUnique({
      where: { name: 'Any' },
      include: { items: true },
    });
    expect(profile).not.toBeNull();
    expect(profile!.items).toHaveLength(5);

    const providers = await prisma.recommendationProviderConfig.findMany();
    expect(providers.map((p) => p.provider).sort()).toEqual(['lastfm', 'musicbrainz', 'spotify']);
  });

  it('is idempotent — running it twice does not create duplicate rows', async () => {
    await ensureDefaultData();
    await ensureDefaultData();

    expect(await prisma.quality.count()).toBe(5);
    expect(await prisma.qualityProfile.count()).toBe(1);
    expect(await prisma.recommendationProviderConfig.count()).toBe(3);
  });

  it('never overwrites an existing "Any" profile the user has already customized', async () => {
    await ensureDefaultData();
    const sd = await prisma.quality.findUniqueOrThrow({ where: { name: 'SD' } });
    await prisma.qualityProfile.update({
      where: { name: 'Any' },
      data: { cutoffQualityId: sd.id },
    });

    await ensureDefaultData();

    const profile = await prisma.qualityProfile.findUniqueOrThrow({ where: { name: 'Any' } });
    expect(profile.cutoffQualityId).toBe(sd.id);
  });
});

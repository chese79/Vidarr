import { beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { prisma } from '../src/db/client.js';
import { validationCategoryForSource, validationOptions } from '../src/pipeline/validationPolicy.js';
import { DEFAULT_VALIDATION_SETTINGS } from '@vidarr/shared-types';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo } from './support/db.js';

beforeEach(resetDb);
it('requires accepted and confirmed authority on the chosen source, with conservative unknown fallback', async () => {
  expect(validationCategoryForSource({ accepted: true, authority: 'verified', confidence: 'confirmed' })).toBe('canonical');
  expect(validationCategoryForSource({ accepted: true, authority: 'authoritative', confidence: 'confirmed' })).toBe('canonical');
  for (const source of [null, {}, { accepted: true, authority: 'manual', confidence: 'confirmed' },
    { accepted: false, authority: 'verified', confidence: 'confirmed' }, { accepted: true, authority: 'verified', confidence: 'review' }]) {
    expect(validationCategoryForSource(source)).toBe('additional');
  }
  expect(await validationOptions('unknown')).toMatchObject({ category: 'additional', checkVideoFile: true, checkVideoMotion: true });
  expect(await validationOptions('canonical')).toMatchObject({ checkVideoFile: false, checkVideoMotion: false });
});

it('backfills populated queues only from the exact chosen accepted source, preserving rows and order', async () => {
  const root = await createRootFolder(), profile = await createQualityProfile((await createQuality()).id);
  const artist = await createArtist(root.id, profile.id);
  const items = [];
  for (const [name, authority, accepted, chosen, type] of [
    ['Trusted', 'verified', true, true, 'youtube'], ['Other selected', 'verified', true, false, 'youtube'],
    ['Manual', 'manual', true, true, 'youtube'], ['Unaccepted', 'verified', false, true, 'youtube'],
    ['Indexer', 'authoritative', true, true, 'indexer'],
  ] as const) {
    const video = await createMusicVideo(artist.id, { title: name });
    await prisma.acquisitionSource.create({ data: { musicVideoId: video.id, provider: 'youtube', url: 'https://youtube.com/watch?v=trusted', authority, confidence: 'confirmed', accepted, discoveryOrigin: 'test' } });
    items.push(await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, sourceType: type,
      sourceRef: chosen ? 'https://youtube.com/watch?v=trusted' : 'https://youtube.com/watch?v=other', status: 'queued', queuePosition: -video.id } }));
  }
  const migration = await fs.readFile(new URL('../prisma/migrations/20261016200000_validation_policies/migration.sql', import.meta.url), 'utf8');
  await prisma.$executeRawUnsafe(migration.slice(migration.indexOf('UPDATE "DownloadQueueItem"')));
  const after = await prisma.downloadQueueItem.findMany({ orderBy: { id: 'asc' } });
  expect(after.map(i => i.validationCategory)).toEqual(['canonical', 'additional', 'additional', 'additional', 'additional']);
  expect(after.map(i => [i.id, i.queuePosition])).toEqual(items.map(i => [i.id, i.queuePosition]));
});

it('reads new settings for later validation and fails visibly for corrupt policy data', async () => {
  const policy = structuredClone(DEFAULT_VALIDATION_SETTINGS); policy.policies.additional.file = false;
  await prisma.settings.create({ data: { id: 1, validationSettings: JSON.stringify(policy) } });
  expect(await validationOptions('additional')).toMatchObject({ checkVideoFile: false, checkVideoMotion: true });
  await prisma.settings.update({ where: { id: 1 }, data: { validationSettings: '{}' } });
  await expect(validationOptions('additional')).rejects.toThrow();
});

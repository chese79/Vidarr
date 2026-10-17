import { beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/db/client.js';
import { sqliteRuntimeUrl } from '../src/db/sqlite.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist } from './support/db.js';

beforeEach(resetDb);

it('limits the runtime pool while preserving the database path and explicit timeouts', () => {
  expect(sqliteRuntimeUrl('file:/config/vidarr.db')).toBe('file:/config/vidarr.db?connection_limit=1&socket_timeout=15&pool_timeout=30');
  expect(sqliteRuntimeUrl('file:./test.db?connection_limit=8&socket_timeout=25&pool_timeout=40'))
    .toBe('file:./test.db?connection_limit=1&socket_timeout=25&pool_timeout=40');
});

it('completes concurrent source writes, page reads and a queue-style transaction without lock errors', async () => {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=15000');
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  const artist = await createArtist(root.id, profile.id);
  await Promise.all([
    prisma.$transaction(async tx => {
      await tx.artist.update({ where: { id: artist.id }, data: { videoInventoryStatus: 'running' } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await tx.artist.update({ where: { id: artist.id }, data: { videoInventoryStatus: 'complete' } });
    }),
    ...Array.from({ length: 20 }, (_, index) => prisma.artistSource.upsert({
      where: { artistId_provider_origin: { artistId: artist.id, provider: 'imvdb', origin: `test-${index}` } },
      create: { artistId: artist.id, provider: 'imvdb', origin: `test-${index}` }, update: { lastSeenAt: new Date() },
    })),
    ...Array.from({ length: 20 }, () => prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })),
  ]);
  expect(await prisma.artistSource.count()).toBe(20);
  expect(await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).toMatchObject({ videoInventoryStatus: 'complete' });
});

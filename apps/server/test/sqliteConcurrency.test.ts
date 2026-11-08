import { beforeEach, expect, it } from 'vitest';
import { prisma, readPrisma, withForegroundReads } from '../src/db/client.js';
import { sqliteRuntimeUrl } from '../src/db/sqlite.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, ensureSettings } from './support/db.js';
import {buildApp} from '../src/app.js';
import {authHeaders,TEST_API_KEY} from './support/http.js';

beforeEach(resetDb);

it('limits the runtime pool while preserving the database path and explicit timeouts', () => {
  expect(sqliteRuntimeUrl('file:/config/vidarr.db')).toBe('file:/config/vidarr.db?connection_limit=1&socket_timeout=15&pool_timeout=30');
  expect(sqliteRuntimeUrl('file:./test.db?connection_limit=8&socket_timeout=25&pool_timeout=40'))
    .toBe('file:./test.db?connection_limit=1&socket_timeout=25&pool_timeout=40');
  expect(sqliteRuntimeUrl('file:/config/vidarr.db', 2)).toContain('connection_limit=2');
});

it('serves committed reads while a writer is held and keeps transaction reads on the writer', async () => {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  const artist = await createArtist(root.id, profile.id);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const writer = prisma.$transaction(async tx => {
    await tx.artist.update({ where: { id: artist.id }, data: { name: 'Uncommitted' } });
    ready();
    await gate;
    expect((await tx.artist.findUniqueOrThrow({ where: { id: artist.id } })).name).toBe('Uncommitted');
    throw new Error('Deliberate rollback');
  }, { timeout: 10000 });
  const rolledBack = expect(writer).rejects.toThrow('Deliberate rollback');
  try {
    await started;
    // This must finish before releasing the writer, rather than queue behind it.
    const row = await withForegroundReads(async () => prisma.artist.findUniqueOrThrow({ where: { id: artist.id } }));
    expect(row.name).toBe(artist.name);
    const [count, page] = await Promise.all([
      readPrisma.artist.count({where:{id:artist.id}}),
      readPrisma.artist.findMany({where:{id:artist.id}}),
    ]);
    expect(count).toBe(1);expect(page[0].name).toBe(artist.name);
  } finally { release(); await rolledBack; }
  expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).name).toBe(artist.name);
});

it('keeps real authenticated requests responsive while the background connection is occupied', async()=>{
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');await ensureSettings({apiKey:TEST_API_KEY});
  await prisma.settings.update({where:{id:1},data:{apiKeyFirstUsedAt:new Date()}});
  const root=await createRootFolder();const app=await buildApp();await app.ready();
  let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const started=new Promise<void>(resolve=>ready=resolve);
  const writer=prisma.$transaction(async tx=>{await tx.rootFolder.update({where:{id:root.id},data:{path:'/uncommitted'}});ready();await gate;throw Error('rollback');},{timeout:10000});
  const rolledBack=expect(writer).rejects.toThrow('rollback');
  try{await started;const response=await app.inject({url:'/api/v1/rootfolder',headers:authHeaders()});expect(response.statusCode).toBe(200);expect(response.json()[0].path).toBe(root.path);}
  finally{release();await rolledBack;await app.close();}
});

it('preserves array transaction ordering and rollback across reads and writes', async () => {
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  const artist = await createArtist(root.id, profile.id);
  const [, row] = await prisma.$transaction([
    prisma.artist.update({ where: { id: artist.id }, data: { name: 'Committed' } }),
    prisma.artist.findUniqueOrThrow({ where: { id: artist.id } }),
  ]);
  expect(row.name).toBe('Committed');
  await expect(prisma.$transaction([
    prisma.artist.update({ where: { id: artist.id }, data: { name: 'Must roll back' } }),
    prisma.artist.findUniqueOrThrow({ where: { id: -1 } }),
  ])).rejects.toThrow();
  expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).name).toBe('Committed');
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

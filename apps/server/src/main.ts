import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { artistRoutes } from './api/artist.js';
import { musicVideoRoutes } from './api/musicvideo.js';
import { qualityProfileRoutes } from './api/qualityprofile.js';
import { rootFolderRoutes } from './api/rootfolder.js';
import { settingsRoutes } from './api/settings.js';
import { libraryConnectorRoutes } from './api/libraryconnector.js';
import { recommendationRoutes } from './api/recommendation.js';
import { recommendationProviderRoutes } from './api/recommendationprovider.js';
import { imvdbRoutes } from './api/imvdb.js';
import { youtubeSourceRoutes } from './api/youtubesource.js';
import { indexerRoutes } from './api/indexer.js';
import { downloadClientRoutes } from './api/downloadclient.js';
import { queueRoutes } from './api/queue.js';
import { systemRoutes } from './api/system.js';
import { historyRoutes } from './api/history.js';
import { calendarRoutes } from './api/calendar.js';
import { startScheduler } from './scheduler/index.js';

// Prisma returns BigInt for byte-count fields (RootFolder.freeSpaceBytes,
// MusicVideoFile.sizeBytes); JSON.stringify can't serialize BigInt natively.
// Byte counts here are nowhere near Number.MAX_SAFE_INTEGER (9 PB), so a plain
// Number conversion is safe — simplest fix, applied once globally rather than
// per-route.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

const app = Fastify({ logger: true });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    reply.code(400).send({ error: 'ValidationError', issues: err.issues });
    return;
  }
  app.log.error(err);
  reply.code(500).send({ error: 'InternalServerError' });
});

await app.register(cors, { origin: true });

app.get('/api/v1/health', async () => ({ status: 'ok' }));

await app.register(artistRoutes);
await app.register(musicVideoRoutes);
await app.register(qualityProfileRoutes);
await app.register(rootFolderRoutes);
await app.register(settingsRoutes);
await app.register(libraryConnectorRoutes);
await app.register(recommendationRoutes);
await app.register(recommendationProviderRoutes);
await app.register(imvdbRoutes);
await app.register(youtubeSourceRoutes);
await app.register(indexerRoutes);
await app.register(downloadClientRoutes);
await app.register(queueRoutes);
await app.register(systemRoutes);
await app.register(historyRoutes);
await app.register(calendarRoutes);

const webDistPath = process.env.WEB_DIST_PATH ?? path.resolve(process.cwd(), '../web/dist');
if (existsSync(webDistPath)) {
  await app.register(fastifyStatic, { root: webDistPath });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) {
      reply.code(404).send({ error: 'NotFound' });
      return;
    }
    reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 7878);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

await startScheduler();

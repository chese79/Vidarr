import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './db/client.js';
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
import { playlistRoutes } from './api/playlist.js';
import { bulkImportRoutes } from './api/bulkimport.js';
import { setupRoutes } from './api/setup.js';

// Prisma returns BigInt for byte-count fields (RootFolder.freeSpaceBytes,
// MusicVideoFile.sizeBytes); JSON.stringify can't serialize BigInt natively.
// Byte counts here are nowhere near Number.MAX_SAFE_INTEGER (9 PB), so a plain
// Number conversion is safe — simplest fix, applied once globally rather than
// per-route.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

// Builds and fully registers the Fastify app, but never listens or touches
// process-level bootstrapping (ensureApiKey, the scheduler) — those are
// main.ts's job. Split out so tests can exercise real routes via .inject()
// without booting the whole process.
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({ error: 'ValidationError', issues: err.issues });
      return;
    }
    // P2025: "record to update/delete not found" — every PUT/DELETE-by-id route
    // relies on this rather than each doing its own findUnique-then-404
    // pre-check, so a bad id consistently reports 404, not a bare 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    // Fastify plugins set a real statusCode on errors they throw for a reason —
    // e.g. @fastify/static's own path-traversal guard throws a 403 "Forbidden"
    // for an escaping path, which should reach the client as 403, not a
    // generic 500 that obscures what actually happened.
    const isErrorWithStatus = err instanceof Error && 'statusCode' in err;
    const statusCode = isErrorWithStatus && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (isErrorWithStatus && statusCode < 500) {
      reply.code(statusCode).send({ error: err.message || 'Error' });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: 'InternalServerError' });
  });

  // No CORS registration: the browser only ever talks to whatever origin
  // served the page — Vite's dev-server proxy in development (see
  // apps/web/vite.config.ts), same-origin static serving in production (this
  // same Fastify instance, below). There is no legitimate cross-origin caller,
  // so a permissive CORS policy here would be pure attack surface, not a
  // feature.

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  // The one other route that must work with no key at all — it's what
  // reveals the key in the first place. See api/setup.ts for the
  // time-boxed, first-use-only logic that keeps this from being a standing
  // unauthenticated secret-disclosure route.
  const UNAUTHENTICATED_PATHS = new Set(['/api/v1/health', '/api/v1/setup/bootstrap-key']);

  // Every other /api/v1/* route requires vidarr's own API key (generated on
  // first boot — see pipeline/auth.ts). Without this, the app was fully
  // unauthenticated: anyone reaching it over the network, or any webpage the
  // user's browser visited, could read or change everything — including every
  // stored third-party credential (indexer/download-client/library-connector
  // keys and passwords). Constant-time comparison to avoid a timing
  // side-channel on the key itself.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/') || UNAUTHENTICATED_PATHS.has(req.url)) return;

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const expected = settings?.apiKey;
    const provided = req.headers['x-api-key'];

    const valid =
      typeof expected === 'string' &&
      typeof provided === 'string' &&
      expected.length === provided.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

    if (!valid) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    // First successful authentication ever — permanently closes the
    // bootstrap-key reveal window from here on (see api/setup.ts). Only
    // written once; every later request on an already-claimed key skips this.
    if (!settings!.apiKeyFirstUsedAt) {
      await prisma.settings.update({ where: { id: 1 }, data: { apiKeyFirstUsedAt: new Date() } });
    }
  });

  await app.register(setupRoutes);
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
  await app.register(playlistRoutes);
  await app.register(bulkImportRoutes);

  // Relative to this module's own location, not process.cwd() — so it
  // resolves correctly whether launched from apps/server (the normal case) or
  // from anywhere else (e.g. `node apps/server/dist/main.js` from a repo root).
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const webDistPath = process.env.WEB_DIST_PATH ?? path.resolve(moduleDir, '../../web/dist');
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

  return app;
}

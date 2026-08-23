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

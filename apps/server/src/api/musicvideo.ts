import type { FastifyInstance } from 'fastify';
import { CreateMusicVideoSchema, UpdateMusicVideoSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { normalizeTitle } from '../pipeline/normalize.js';
import { grabYoutubeVideo, grabFromIndexer } from '../pipeline/grab.js';
import { searchAllIndexers } from '../pipeline/search.js';
import { autoSearchAndGrab } from '../pipeline/autoSearch.js';

export async function musicVideoRoutes(app: FastifyInstance) {
  app.get('/api/v1/musicvideo', async (req) => {
    const query = req.query as { artistId?: string; hasFile?: string };
    return prisma.musicVideo.findMany({
      where: {
        artistId: query.artistId ? Number(query.artistId) : undefined,
        hasFile: query.hasFile !== undefined ? query.hasFile === 'true' : undefined,
      },
      include: { artist: true },
      orderBy: { addedAt: 'desc' },
    });
  });

  app.post('/api/v1/musicvideo', async (req, reply) => {
    const body = CreateMusicVideoSchema.parse(req.body);
    const created = await prisma.musicVideo.create({
      data: {
        artistId: body.artistId,
        title: body.title,
        normalizedTitle: normalizeTitle(body.title),
        imvdbVideoId: body.imvdbVideoId ?? null,
        youtubeVideoId: body.youtubeVideoId ?? null,
        releaseYear: body.releaseYear ?? null,
        director: body.director ?? null,
        monitored: body.monitored,
        thumbnailUrl: body.thumbnailUrl ?? null,
      },
    });
    reply.code(201);
    return created;
  });

  app.put('/api/v1/musicvideo/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdateMusicVideoSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.title) data.normalizedTitle = normalizeTitle(body.title);
    return prisma.musicVideo.update({ where: { id }, data });
  });

  app.delete('/api/v1/musicvideo/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.musicVideo.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/musicvideo/:id/grab', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      const result = await grabYoutubeVideo(id);
      return { ok: true, path: result.path };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get('/api/v1/musicvideo/:id/search', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const musicVideo = await prisma.musicVideo.findUnique({
      where: { id },
      include: { artist: true },
    });
    if (!musicVideo) return reply.code(404).send({ error: 'Music video not found' });
    return searchAllIndexers(`${musicVideo.artist.name} ${musicVideo.title}`);
  });

  app.post('/api/v1/musicvideo/:id/grab-release', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { downloadClientId: number; downloadUrl: string; quality: string };
    try {
      await grabFromIndexer(id, body.downloadClientId, body.downloadUrl, body.quality);
      return { ok: true };
    } catch (err) {
      reply.code(502);
      return { ok: false, error: (err as Error).message };
    }
  });

  // Bulk "search selected" from the Artist Detail page's video list — auto-picks
  // the best allowed-quality result per video and grabs it, same logic the
  // scheduled backlog search uses, just run on-demand for a chosen subset.
  app.post('/api/v1/musicvideo/bulk-search', async (req) => {
    const body = req.body as { ids: number[] };
    let grabbed = 0;
    let skipped = 0;
    for (const id of body.ids) {
      try {
        const outcome = await autoSearchAndGrab(id);
        if (outcome.grabbed) grabbed++;
        else skipped++;
      } catch (err) {
        skipped++;
        await prisma.activityLog.create({
          data: { level: 'warn', source: 'bulk-search', message: (err as Error).message },
        });
      }
    }
    return { grabbed, skipped };
  });
}

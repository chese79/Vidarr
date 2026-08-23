import type { FastifyInstance } from 'fastify';
import { CreateMusicVideoSchema, UpdateMusicVideoSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { normalizeTitle } from '../pipeline/normalize.js';

export async function musicVideoRoutes(app: FastifyInstance) {
  app.get('/api/v1/musicvideo', async (req) => {
    const artistId = (req.query as { artistId?: string }).artistId;
    return prisma.musicVideo.findMany({
      where: artistId ? { artistId: Number(artistId) } : undefined,
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
}

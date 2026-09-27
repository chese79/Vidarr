import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { normalizeTitle } from '../pipeline/normalize.js';
import { scanLocalVideoCandidates } from '../pipeline/localVideoReview.js';

export async function videoReviewRoutes(app: FastifyInstance) {
  app.get('/api/v1/video-review', async () => prisma.videoReviewCandidate.findMany({
    where: { decision: 'pending' },
    include: { artist: { select: { id: true, name: true, musicbrainzMatchStatus: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }));

  app.post('/api/v1/video-review/scan-local', async (_req, reply) => {
    try { return await scanLocalVideoCandidates(); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });

  app.post('/api/v1/video-review/:id/reject', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const candidate = await prisma.videoReviewCandidate.findUnique({ where: { id } });
    if (!candidate) return reply.code(404).send({ error: 'Candidate not found' });
    if (candidate.decision !== 'pending') return reply.code(409).send({ error: 'Candidate already reviewed' });
    return prisma.videoReviewCandidate.update({
      where: { id }, data: { decision: 'rejected', reason: 'Rejected during video review.' },
    });
  });

  app.post('/api/v1/video-review/:id/approve', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { artistId?: number; title?: string } | null;
    const artistId = Number(body?.artistId);
    const title = body?.title?.trim() ?? '';
    if (!Number.isInteger(artistId) || artistId <= 0 || !normalizeTitle(title)) {
      return reply.code(400).send({ error: 'Select a confirmed artist and enter the song title' });
    }
    const candidate = await prisma.videoReviewCandidate.findUnique({ where: { id } });
    if (!candidate) return reply.code(404).send({ error: 'Candidate not found' });
    if (candidate.decision !== 'pending') return reply.code(409).send({ error: 'Candidate already reviewed' });
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist || artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) {
      return reply.code(409).send({ error: 'Artist must be confirmed in MusicBrainz first' });
    }
    let localSize = 0n;
    if (candidate.source === 'local') {
      if (!candidate.filePath) return reply.code(409).send({ error: 'Local file path is missing' });
      try { const stat = await fs.stat(candidate.filePath); if (!stat.isFile()) throw new Error('Not a file'); localSize = BigInt(stat.size); }
      catch { return reply.code(409).send({ error: 'Local video file is no longer available' }); }
    } else if (candidate.source !== 'youtube' || !candidate.url) {
      return reply.code(409).send({ error: 'Unsupported review source' });
    }

    const existingVideo = await prisma.musicVideo.findUnique({
      where: { artistId_normalizedTitle: { artistId, normalizedTitle: normalizeTitle(title) } },
      include: { file: true },
    });
    if (candidate.source === 'local' && existingVideo?.file && existingVideo.file.path !== candidate.filePath) {
      return reply.code(409).send({ error: 'This song already has a different owned file' });
    }

    return prisma.$transaction(async (tx) => {
      const video = await tx.musicVideo.upsert({
        where: { artistId_normalizedTitle: { artistId, normalizedTitle: normalizeTitle(title) } },
        update: {},
        create: { artistId, title, normalizedTitle: normalizeTitle(title), catalogKind: 'supplementary', monitored: false },
      });
      if (candidate.source === 'local' && candidate.filePath) {
        const owned = await tx.musicVideoFile.findUnique({ where: { musicVideoId: video.id } });
        if (owned && owned.path !== candidate.filePath) throw new Error('This song already has a different owned file');
        await tx.musicVideoFile.upsert({
          where: { musicVideoId: video.id }, update: {},
          create: { musicVideoId: video.id, path: candidate.filePath, sizeBytes: localSize, originalFilename: candidate.filePath.split(/[\\/]/).pop()! },
        });
        await tx.musicVideo.update({ where: { id: video.id }, data: { hasFile: true } });
      }
      if (candidate.source === 'youtube' && candidate.url) {
        await tx.acquisitionSource.upsert({
          where: { musicVideoId_provider_url: { musicVideoId: video.id, provider: 'youtube', url: candidate.url } },
          update: { accepted: true, confidence: 'confirmed' },
          create: {
            musicVideoId: video.id, provider: 'youtube', externalId: candidate.externalId,
            url: candidate.url, authority: 'manual', confidence: 'confirmed',
            discoveryOrigin: 'video-review', accepted: true,
          },
        });
      }
      await tx.videoReviewCandidate.update({ where: { id }, data: { decision: 'approved', artistId, title, reason: 'Approved as a song music video.' } });
      return video;
    });
  });
}

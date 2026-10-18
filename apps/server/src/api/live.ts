import { performanceStates } from '../live/status.js';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CreateLivePerformance, CreateRecordingCandidate, UpdateLivePerformance, LiveSetting, LiveStyle } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const querySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(), artistId: z.coerce.number().int().positive().optional(),
  setting: LiveSetting.optional(), style: LiveStyle.optional(),
});
const artistSelect = { id: true, name: true } as const;
const summaryInclude = { artist: { select: artistSelect }, _count: { select: { songs: true, recordings: true } } } as const;
const recordingInclude = { performances: { include: { performance: { select: { id: true, title: true, artist: { select: artistSelect } } } } } } as const;

export async function liveRoutes(app: FastifyInstance) {
  app.get('/api/v1/live/artists', async req => {
    const query = querySchema.parse(req.query);
    const where = { id: query.artistId, musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null }, ...(query.search ? { name: { contains: query.search } } : {}) };
    const [total, items] = await prisma.$transaction([prisma.artist.count({ where }),
      prisma.artist.findMany({ where, select: artistSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: query.offset, take: query.limit })]);
    return { total, items, offset: query.offset, limit: query.limit };
  });

  app.get('/api/v1/live/performances', async req => {
    const query = querySchema.parse(req.query);
    const where: Prisma.LivePerformanceWhereInput = {
      removedAt: null, artistId: query.artistId, setting: query.setting, style: query.style,
      ...(query.search ? { OR: [{ title: { contains: query.search } }, { venue: { contains: query.search } },
        { city: { contains: query.search } }, { artist: { name: { contains: query.search } } }] } : {}),
    };
    const [total, rows] = await prisma.$transaction([prisma.livePerformance.count({ where }),
      prisma.livePerformance.findMany({ where, include: summaryInclude, orderBy: { id: 'desc' }, skip: query.offset, take: query.limit })]);
    const states = await performanceStates(rows.map(row => row.id));
    return { total, offset: query.offset, limit: query.limit, items: rows.map(row => ({ ...row, recordingState: states.get(row.id) })) };
  });

  app.post('/api/v1/live/performances', async (req, reply) => {
    const { songs, ...data } = CreateLivePerformance.parse(req.body);
    const result = await prisma.$transaction(async tx => {
      const artist = await tx.artist.findUnique({ where: { id: data.artistId } });
      if (!artist || artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) return null;
      return tx.livePerformance.create({ data: { ...data, songs: { create: songs.map((song, position) => ({ ...song, position: position + 1 })) } }, include: summaryInclude });
    });
    if (!result) return reply.code(409).send({ error: 'Choose an existing MusicBrainz-confirmed Library artist' });
    return reply.code(201).send({ ...result, recordingState: 'recordingUnknown' });
  });

  app.get('/api/v1/live/performances/:id', async req => {
    const { id } = idParams.parse(req.params);
    const row = await prisma.livePerformance.findUniqueOrThrow({ where: { id }, include: { ...summaryInclude,
      credits: { include: { artist: { select: artistSelect } } }, occasion: { include: { performances: { select: { id: true, title: true, artistId: true } } } },
      songs: { orderBy: { position: 'asc' } }, recordings: { take: 25, orderBy: { recordingId: 'desc' }, include: { recording: { include: recordingInclude } } } } });
    return { ...row, recordingState: (await performanceStates([row.id])).get(row.id) };
  });

  app.patch('/api/v1/live/performances/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { revision, ...data } = UpdateLivePerformance.parse(req.body);
    const row = await prisma.$transaction(async tx => {
      await tx.livePerformance.findUniqueOrThrow({ where: { id }, select: { id: true } });
      const updated = await tx.livePerformance.updateMany({ where: { id, revision }, data: { ...data, userEdited: true, revision: { increment: 1 } } });
      if (!updated.count) return null;
      return tx.livePerformance.findUniqueOrThrow({ where: { id }, include: summaryInclude });
    });
    if (!row) return reply.code(409).send({ error: 'This performance changed; reload before saving your corrections' });
    return { ...row, recordingState: (await performanceStates([row.id])).get(row.id) };
  });

  app.get('/api/v1/live/recordings', async req => {
    const query = querySchema.parse(req.query);
    const where: Prisma.RecordingWhereInput = { catalogType: 'live', reviewStatus: { notIn: ['returnedToMusicVideos', 'deleted', 'identifiedDuplicate'] }, performances: { some: { performance: { removedAt: null, artistId: query.artistId, setting: query.setting, style: query.style } } },
      ...(query.search ? { title: { contains: query.search } } : {}) };
    const [total, items] = await prisma.$transaction([prisma.recording.count({ where }),
      prisma.recording.findMany({ where, include: recordingInclude, orderBy: { id: 'desc' }, skip: query.offset, take: query.limit })]);
    return { total, items, offset: query.offset, limit: query.limit };
  });

  app.post('/api/v1/live/recordings', async (req, reply) => {
    const { performanceIds, ...data } = CreateRecordingCandidate.parse(req.body);
    const row = await prisma.$transaction(async tx => {
      if (await tx.livePerformance.count({ where: { id: { in: performanceIds }, removedAt: null } }) !== performanceIds.length) return null;
      return tx.recording.create({ data: { ...data, performances: { create: performanceIds.map(performanceId => ({ performanceId })) } }, include: recordingInclude });
    });
    if (!row) return reply.code(404).send({ error: 'A selected performance no longer exists' });
    return reply.code(201).send(row);
  });
}

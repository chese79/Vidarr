import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { startMetadataEnrichment, reviewEnrichmentItem } from '../pipeline/metadataEnrichment.js';

export async function metadataEnrichmentRoutes(app: FastifyInstance) {
  app.get('/api/v1/metadata-enrichment', async () => (await prisma.metadataEnrichmentRun.findMany({ orderBy: { id: 'desc' }, take: 20, include: { items: { where: { status: 'pending' }, orderBy: { id: 'asc' }, take: 1, select: { title: true, artistName: true } } } })).map(({ items, ...run }) => ({ ...run, currentItem: items[0] ?? null })));
  app.post('/api/v1/metadata-enrichment', async (request, reply) => {
    const { connectorId } = z.object({ connectorId: z.number().int().positive() }).parse(request.body);
    try { return await startMetadataEnrichment(connectorId); } catch (error) { return reply.code(409).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: { id: string } }>('/api/v1/metadata-enrichment/:id/items', async request => {
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), search: z.string().max(200).default(''), status: z.enum(['pending', 'complete', 'updated', 'review', 'unknown', 'failed']).optional() }).parse(request.query);
    const where = { runId: z.coerce.number().int().positive().parse(request.params.id), ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ title: { contains: query.search } }, { artistName: { contains: query.search } }] } : {}) };
    const [items, total] = await Promise.all([prisma.metadataEnrichmentItem.findMany({ where, orderBy: { id: 'asc' }, skip: (query.page - 1) * 25, take: 25 }), prisma.metadataEnrichmentItem.count({ where })]);
    return { total, items: items.map(item => ({ id: item.id, title: item.title, artistName: item.artistName, status: item.status, changed: item.changed, before: JSON.parse(item.resultJson ?? item.beforeJson), proposal: JSON.parse(item.proposalJson), error: item.error })) };
  });
  app.post<{ Params: { id: string } }>('/api/v1/metadata-enrichment/:id/control', async (request, reply) => {
    const id = z.coerce.number().int().positive().parse(request.params.id);
    const { action } = z.object({ action: z.enum(['pause', 'resume', 'retry', 'cancel']) }).parse(request.body);
    const run = await prisma.metadataEnrichmentRun.findUniqueOrThrow({ where: { id } });
    const other = await prisma.metadataEnrichmentRun.findFirst({ where: { connectorId: run.connectorId, status: { in: ['running', 'paused'] }, id: { not: id } } });
    if (!['pause', 'cancel'].includes(action) && other) return reply.code(409).send({ error: 'Another batch owns this connector; finish or cancel it first.' });
    if (action === 'cancel') return prisma.metadataEnrichmentRun.update({ where: { id }, data: { status: 'cancelled' } });
    if (action === 'retry') {
      const first = await prisma.metadataEnrichmentItem.findFirst({ where: { runId: id, status: 'failed' }, orderBy: { libraryVideoId: 'asc' } });
      if (!first) return run;
      await prisma.metadataEnrichmentItem.updateMany({ where: { runId: id, status: 'failed' }, data: { status: 'pending', error: null } });
      return prisma.metadataEnrichmentRun.update({ where: { id }, data: { status: 'running', cursor: first.libraryVideoId - 1, error: null } });
    }
    return prisma.metadataEnrichmentRun.update({ where: { id }, data: { status: action === 'pause' ? 'paused' : 'running', error: null } });
  });
  app.post<{ Params: { id: string } }>('/api/v1/metadata-enrichment/items/:id/apply', async (request, reply) => {
    const body = z.object({ evidenceIndex: z.number().int().min(0), fields: z.array(z.enum(['artist', 'title', 'album', 'albumYear', 'recordLabel', 'directors'])).min(1), corrections: z.boolean().default(false) }).parse(request.body);
    try { return await reviewEnrichmentItem(z.coerce.number().int().positive().parse(request.params.id), body.evidenceIndex, body.fields, body.corrections); }
    catch (error) { return reply.code(409).send({ error: (error as Error).message }); }
  });
}

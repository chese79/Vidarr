import type { FastifyInstance } from 'fastify';
import { existingArtistDiscoveryStatus } from '../pipeline/existingArtistDiscovery.js';
import { z } from 'zod';
import { prisma, logActivity } from '../db/client.js';
import { liveEnabled, requireLiveEnabled } from '../live/capability.js';
import { backfillLiveStartingInventories, liveStartingItems, openLiveStartingItem, prepareLiveStartingInventory, visibleLiveDiscoveries } from '../live/startingInventory.js';
import { collectArtistVideoInventory } from '../pipeline/artistVideoInventory.js';

const params = z.object({ id: z.coerce.number().int().positive() });
const queued = new Set<number>();
let rootQueued = false;
export async function liveStartRoutes(app: FastifyInstance) {
  app.get('/api/v1/live/source-refresh-status', existingArtistDiscoveryStatus);
  app.get('/api/v1/live/start', async () => {
    const enabled = await liveEnabled();
    const select = { id: true, name: true, liveDiscoveryStatus: true, _count: { select: { liveDiscoveryItems: { where: visibleLiveDiscoveries } } } } as const;
    const videos = await prisma.artist.findMany({ where: { musicbrainzMatchStatus: 'confirmed', liveDiscoveryItems: { some: { ...visibleLiveDiscoveries, kind: 'video' } } }, select, orderBy: { addedAt: 'desc' }, take: 5 });
    const references = videos.length < 5 ? await prisma.artist.findMany({ where: { id: { notIn: videos.map(row => row.id) }, musicbrainzMatchStatus: 'confirmed', liveDiscoveryItems: { some: { ...visibleLiveDiscoveries, kind: 'reference' } } }, select, orderBy: { addedAt: 'desc' }, take: 5 - videos.length }) : [];
    return { enabled, items: [...videos, ...references] };
  });
  app.post('/api/v1/live/start/prepare', async (_req, reply) => {
    await requireLiveEnabled();
    if (!rootQueued) {
      rootQueued = true;
      void backfillLiveStartingInventories().catch(error => logActivity('warn', 'live-start', error)).finally(() => { rootQueued = false; });
    }
    return reply.code(202).send({ queued: true });
  });
  app.get('/api/v1/live/artists/:id/start', req => {
    const { id } = params.parse(req.params);
    const query = z.object({ kind: z.enum(['video', 'reference']).default('video'), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(25).default(5) }).parse(req.query);
    return liveStartingItems(id, query.kind, query.offset, query.limit);
  });
  app.post('/api/v1/live/artists/:id/prepare', async (req, reply) => {
    await requireLiveEnabled();
    const { id } = params.parse(req.params), { refresh } = z.object({ refresh: z.boolean().default(false) }).strict().parse(req.body ?? {});
    const artist = await prisma.artist.findUniqueOrThrow({ where: { id } });
    if (artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) return reply.code(409).send({ error: 'Confirm the artist in MusicBrainz first' });
    const recent = artist.liveDiscoveryAttemptedAt && artist.liveDiscoveryAttemptedAt.getTime() > Date.now() - 10 * 60_000;
    if (!queued.has(id) && (refresh || (!recent && (artist.liveDiscoveryStatus !== 'complete' || artist.videoInventoryStatus !== 'complete')))) {
      queued.add(id);
      void (async () => {
        await Promise.all([prepareLiveStartingInventory(id, refresh),
          collectArtistVideoInventory(id, { refreshImvdb: false, scanLocal: false, enrichIdentity: true })]);
      })().catch(error => logActivity('warn', `live-start:${id}`, error)).finally(() => queued.delete(id));
    }
    return reply.code(202).send({ queued: queued.has(id) });
  });
  app.post('/api/v1/live/artists/:id/start/:itemId/open', req => {
    const { id } = params.parse(req.params), { itemId } = z.object({ itemId: z.coerce.number().int().positive() }).parse(req.params);
    return openLiveStartingItem(id, itemId);
  });
  app.patch('/api/v1/live/artists/:id/start/:itemId', async req => {
    const { id } = params.parse(req.params), { itemId } = z.object({ itemId: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({ dismissed: z.boolean() }).strict().parse(req.body);
    await prisma.liveDiscoveryItem.updateMany({ where: { id: itemId, artistId: id }, data: body }); return { ok: true };
  });
}

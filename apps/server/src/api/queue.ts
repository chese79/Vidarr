import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { refreshQueue } from '../pipeline/grab.js';
import { z } from 'zod';
import { getDownloadClientProvider } from '../providers/downloadclient/index.js';
import { isDownloadRunnerActive, wakeDownloadQueue } from '../pipeline/downloadDispatcher.js';
import { readDownloadTimings } from '../pipeline/downloadTimings.js';
import { redactMessage } from '../security/redact.js';

export async function queueRoutes(app: FastifyInstance) {
  app.post('/api/v1/queue/:id/reconcile', async (req, reply) => {
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('attach'), externalRef: z.string().trim().min(1).max(200), verified: z.literal(true) }),
      z.object({ action: z.literal('notSubmitted'), verified: z.literal(true) }),
    ]).parse(req.body);
    const item = await prisma.downloadQueueItem.findUnique({ where: { id }, include: { downloadClient: true } });
    if (!item) return reply.code(404).send({ error: 'Queue item not found' });
    if (item.status !== 'submissionUnknown' || item.sourceType !== 'indexer' || isDownloadRunnerActive(id)) {
      return reply.code(409).send({ error: 'Only an unresolved external submission can be reconciled after its submission attempt finishes.' });
    }
    let progress = 0;
    if (body.action === 'attach') {
      if (!item.downloadClient) return reply.code(409).send({ error: 'Download client is missing; restore its configuration first.' });
      // A magnet exposes a stable handle, so reject a different torrent even if it exists.
      const expectedHash = /xt=urn:btih:([a-f0-9]{40})/i.exec(item.sourceRef)?.[1];
      if (item.downloadClient.implementation === 'qBittorrent' && expectedHash && expectedHash.toLowerCase() !== body.externalRef.toLowerCase()) {
        return reply.code(409).send({ error: 'Torrent hash does not match this requested video download.' });
      }
      try {
        const status = await getDownloadClientProvider(item.downloadClient.implementation)
          .getStatus(item.downloadClient, body.externalRef, item.downloadClient.category || 'vidarr');
        if (status.status === 'failed') return reply.code(409).send({ error: 'That job is missing or failed in the client. Verify the correct job before linking it.' });
        progress = status.progress;
      } catch (error) { return reply.code(502).send({ error: redactMessage(error) }); }
    }
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.downloadQueueItem.updateMany({ where: { id, status: 'submissionUnknown' }, data:
        body.action === 'attach' ? { status: 'downloading', sourceRef: body.externalRef, progress, error: null }
          : { status: 'failed', error: 'User verified the job was not submitted to the download client.' } });
      if (result.count) await tx.history.create({ data: { musicVideoId: item.musicVideoId,
        eventType: body.action === 'attach' ? 'downloadSubmissionReconciled' : 'downloadFailed',
        data: JSON.stringify({ action: body.action, downloadClient: item.downloadClient?.name,
          ...(body.action === 'notSubmitted' ? { error: 'Verified not submitted; reservation released. Review the artist/video to retry.' } : {}) }) } });
      return result.count;
    });
    if (!updated) return reply.code(409).send({ error: 'Queue item changed; refresh before reconciling.' });
    wakeDownloadQueue();
    return { ok: true, action: body.action };
  });
  app.get('/api/v1/queue', async (req) => {
    const { activeOnly } = z.object({ activeOnly: z.enum(['true', 'false']).optional() }).parse(req.query);
    const items = await prisma.downloadQueueItem.findMany({
      where: activeOnly === 'true' ? { status: { in: ['queued', 'downloading', 'importing', 'submissionUnknown'] } } : undefined,
      include: { musicVideo: { include: { artist: true } } },
      orderBy: { addedAt: 'desc' },
    });
    return items.map(item => ({ ...item, stageTimings: item.stageTimings ? readDownloadTimings(item.stageTimings) : null }));
  });

  for (const [section, eventType] of [['completed', 'downloadFolderImported'], ['failures', 'downloadFailed']] as const) {
    app.get(`/api/v1/queue/${section}`, async (req) => {
      const { page, pageSize } = z.object({
        page: z.coerce.number().int().min(1).max(1000000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      }).parse(req.query);
      const where = { eventType };
      const [total, items] = await prisma.$transaction([
        prisma.history.count({ where }),
        prisma.history.findMany({ where, orderBy: [{ date: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize, take: pageSize,
          include: { musicVideo: { include: { artist: { include: { rootFolder: { select: { targetConnectorId: true } } } },
            libraryVideos: { where: { available: true, matchConfidence: null, connector: { enabled: true } }, select: { connectorId: true } } } } } }),
      ]);
      return { total, page, pageSize, items: items.map(item => ({ ...item,
        ...(section === 'completed' ? { deliveryStatus: item.musicVideo.awaitingServerScanAt ? 'awaitingServerCataloging'
          : item.musicVideo.artist.rootFolder.targetConnectorId && item.musicVideo.libraryVideos.some(video => video.connectorId === item.musicVideo.artist.rootFolder.targetConnectorId)
            ? 'readyToPlay' : 'localOnly' } : {}),
      })) };
    });
  }

  app.post('/api/v1/queue/refresh', async () => {
    return refreshQueue();
  });
}

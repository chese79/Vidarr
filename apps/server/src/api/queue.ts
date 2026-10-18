import { liveConfiguration } from '../live/policy.js';
import { assertRecordingEligible } from '../live/acquisition.js';
import fs from 'node:fs/promises';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { refreshQueue } from '../pipeline/grab.js';
import { z } from 'zod';
import { getDownloadClientProvider } from '../providers/downloadclient/index.js';
import { isDownloadRunnerActive, wakeDownloadQueue } from '../pipeline/downloadDispatcher.js';
import { readDownloadTimings } from '../pipeline/downloadTimings.js';
import { redactMessage } from '../security/redact.js';

export async function queueRoutes(app: FastifyInstance) {
  app.post('/api/v1/queue/:id/retry', async (req, reply) => {
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const { action } = z.object({ action: z.enum(['retryStaged', 'retryDirect']) }).strict().parse(req.body);
    const item = await prisma.downloadQueueItem.findUniqueOrThrow({ where: { id } });
    if (item.status !== 'failed' || isDownloadRunnerActive(id)) return reply.code(409).send({ error: 'Only a finished failed attempt can be retried; uncertain submissions require reconciliation.' });
    if (item.musicVideoId === null && item.recordingId) await assertRecordingEligible(item.recordingId);
    else {
      const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id: item.musicVideoId! } });
      if (video.ignored || video.deletionState || video.catalogKind === 'liveClassified') return reply.code(409).send({ error: 'Review the current video or live classification before retrying this attempt.' });
    }
    if (action === 'retryStaged') {
      if (!item.downloadedPath || !await fs.stat(item.downloadedPath).then(stat => stat.isFile() || item.musicVideoId === null && stat.isDirectory(), () => false)) return reply.code(409).send({ error: 'The retained download is unavailable; restore its mount or choose another source.' });
    } else if (item.sourceType === 'indexer' || item.downloadedPath) return reply.code(409).send({ error: 'Reuse the retained download or review a new source. External jobs are never blindly submitted again.' });
    if (action === 'retryDirect' && item.musicVideoId === null && !await prisma.recordingSource.count({ where: { id: item.recordingSourceId ?? -1, recordingId: item.recordingId!, accepted: true, available: true } })) return reply.code(409).send({ error: 'Review an accepted available source before retrying the transfer.' });
    const changed = await prisma.downloadQueueItem.updateMany({ where: { id, status: 'failed' }, data: action === 'retryStaged'
      ? { status: 'importing', phase: 'waitingValidation', error: null, processingStartedAt: null }
      : { status: 'queued', phase: null, error: null, progress: 0 } });
    if (!changed.count) return reply.code(409).send({ error: 'The queue item changed; refresh before retrying.' });
    wakeDownloadQueue(); return { ok: true };
  });
  app.post('/api/v1/queue/:id/move', async (req, reply) => {
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const { direction } = z.object({ direction: z.enum(['up', 'down', 'top', 'bottom']) }).parse(req.body);
    const outcome = await prisma.$transaction(async tx => {
      // Lock before reading order so a dispatcher claim or concurrent reorder
      // cannot change the waiting set halfway through the update.
      const locked = await tx.downloadQueueItem.updateMany({ where: { id, status: 'queued' }, data: { status: 'queued' } });
      if (!locked.count) return await tx.downloadQueueItem.findUnique({ where: { id } }) ? 'active' : 'missing';
      const items = await tx.downloadQueueItem.findMany({ where: { status: 'queued' },
        orderBy: [{ queuePosition: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      const from = items.findIndex(item => item.id === id);
      const to = direction === 'top' ? 0 : direction === 'bottom' ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, from + (direction === 'up' ? -1 : 1)));
      if (from === to) return 'ok';
      const [item] = items.splice(from, 1); items.splice(to, 0, item);
      // Keep round trips bounded for large queues, staying below SQLite's
      // conservative 999-parameter limit (three bindings per item).
      for (let offset = 0; offset < items.length; offset += 250) {
        const batch = items.slice(offset, offset + 250);
        await tx.$executeRaw(Prisma.sql`UPDATE "DownloadQueueItem" SET "queuePosition" = CASE "id"
          ${Prisma.join(batch.map((entry, index) => Prisma.sql`WHEN ${entry.id} THEN ${offset + index - items.length}`), ' ')}
          ELSE "queuePosition" END
          WHERE "status" = 'queued' AND "id" IN (${Prisma.join(batch.map(entry => entry.id))})`);
      }
      return 'ok';
    }, { timeout: 15000 });
    if (outcome === 'missing') return reply.code(404).send({ error: 'Queue item not found' });
    if (outcome === 'active') return reply.code(409).send({ error: 'Only waiting downloads can be reordered. Refresh the queue and try again.' });
    wakeDownloadQueue();
    return { ok: true };
  });
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
      if (result.count) await tx.history.create({ data: { musicVideoId: item.musicVideoId, recordingId: item.recordingId,
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
      where: activeOnly === 'true' ? { status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } : undefined,
      include: { recording: { include: { performances: { include: { performance: { include: { artist: true } } } } } }, musicVideo: { include: { artist: true } } },
      orderBy: [{ queuePosition: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }],
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
          include: { recording: { select: { id: true, title: true, claimedCoverage: true, parts: { select: { available: true, serverCopies: { where: { available: true, connector: { enabled: true } }, select: { connectorId: true, libraryId: true } } } } } }, musicVideo: { include: { artist: { include: { rootFolder: { select: { targetConnectorId: true } } } },
            libraryVideos: { where: { available: true, matchConfidence: null, connector: { enabled: true } }, select: { connectorId: true } } } } } }),
      ]);
      const { policy } = await liveConfiguration();
      const recordingDelivery = (item: typeof items[number]) => {
        const connectorId = item.recording?.claimedCoverage === 'individualSong' ? policy.songConnectorId : policy.fullConnectorId;
        const libraryId = item.recording?.claimedCoverage === 'individualSong' ? policy.songLibraryId : policy.fullLibraryId;
        return !connectorId || !libraryId ? 'localOnly' : item.recording?.parts.length && item.recording.parts.every(part => part.serverCopies.some(copy => copy.connectorId === connectorId && copy.libraryId === libraryId)) ? 'readyToPlay' : 'awaitingServerCataloging';
      };
      return { total, page, pageSize, items: items.map(item => ({ ...item,
        ...(section === 'completed' ? { deliveryStatus: !item.musicVideo ? recordingDelivery(item) : item.musicVideo.awaitingServerScanAt ? 'awaitingServerCataloging'
          : item.musicVideo.artist.rootFolder.targetConnectorId && item.musicVideo.libraryVideos.some(video => video.connectorId === item.musicVideo?.artist.rootFolder.targetConnectorId)
            ? 'readyToPlay' : 'localOnly' } : {}),
      })) };
    });
  }

  app.post('/api/v1/queue/refresh', async () => {
    return refreshQueue();
  });
}

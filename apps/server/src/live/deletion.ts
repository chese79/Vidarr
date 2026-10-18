import fs from 'node:fs/promises';
import { z } from 'zod';
import { prisma, logActivity } from '../db/client.js';
import { checkLocalPath, localBundle } from '../pipeline/deleteVideo.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import { redactMessage } from '../security/redact.js';
import { LiveError } from './policy.js';
import { assertExclusiveLocalFiles } from '../media/localFileOwnership.js';

const snapshotSchema = z.object({ files: z.array(z.string()), partIds: z.array(z.number()), targets: z.array(z.object({ connectorId: z.number(), host: z.string(), type: z.string(), libraryId: z.string(), externalId: z.string(), expectedPath: z.string() })),
  exclusions: z.array(z.object({ artistId: z.number(), scope: z.string(), fingerprint: z.string() })) });
export async function scheduleRecordingDeletion(id: number, confirmed: boolean, scope: 'recording' | 'rendition' | 'artistSet' = 'recording', songId?: number, performanceId?: number) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if ((settings?.warnBeforeDelete ?? true) && !confirmed) throw new LiveError('Confirm deletion of local files and matched playback-server copies');
  const recording = await prisma.recording.findUniqueOrThrow({ where: { id }, include: { parts: { include: { coverage: true, serverCopies: { include: { connector: true } } } }, sources: true, performances: { include: { performance: true } } } });
  if (recording.catalogType !== 'live') throw new LiveError('Use the music-video deletion workflow for this entry');
  if (recording.deletionState === 'deleted') return;
  if (recording.deletionState === 'running' || recording.deletionState === 'pending') throw new LiveError('Deletion is already scheduled');
  if (scope === 'rendition' && (!songId || !await prisma.liveSongPerformance.count({ where: { id: songId, performanceId: { in: recording.performances.map(link => link.performanceId) } } }))) throw new LiveError('Choose the particular song occurrence to exclude');
  if (scope === 'rendition' && (recording.claimedCoverage !== 'individualSong' || recording.parts.some(part => !part.coverage.length || part.coverage.some(item => item.songId !== songId || !item.verified || !item.fullSong)))) throw new LiveError('A rendition deletion requires its own verified song clip; deleting a chapter cannot remove an entire shared concert file');
  if (scope === 'artistSet' && recording.performances.length !== 1) throw new LiveError('This file contains several artist sets. Choose whole-recording deletion explicitly; an artist-set deletion cannot remove unrelated performances');
  const files: string[] = [], targets: z.infer<typeof snapshotSchema>['targets'] = [];
  for (const part of recording.parts) {
    if (part.available) {
      if (!part.path) throw new LiveError('Resolve the local file ownership conflict before deleting');
      files.push(...await localBundle(part.path));
    }
    for (const copy of part.serverCopies) targets.push({ connectorId: copy.connectorId, host: copy.connector.host, type: copy.connector.type, libraryId: copy.libraryId, externalId: copy.externalId, expectedPath: copy.expectedPath });
  }
  const selectedEvent = performanceId ?? (recording.performances.length === 1 ? recording.performances[0].performanceId : undefined);
  await assertExclusiveLocalFiles(files, { recordingId: id, musicVideoId: recording.musicVideoId });
  if (scope === 'artistSet' && !recording.performances.some(link => link.performanceId === selectedEvent)) throw new LiveError('Choose the particular artist performance to exclude; a compilation must not exclude unrelated sets');
  const exclusions: z.infer<typeof snapshotSchema>['exclusions'] = [];
  if (settings?.excludeDeletedVideosFromScans) {
    for (const link of recording.performances) {
      if (scope === 'artistSet' && link.performanceId === selectedEvent) exclusions.push({ artistId: link.performance.artistId, scope, fingerprint: `artistSet:${link.performance.artistId}:${link.performanceId}` });
      else if (scope === 'rendition') exclusions.push({ artistId: link.performance.artistId, scope, fingerprint: `rendition:${songId}` });
      else if (scope === 'recording') {
        for (const source of recording.sources) exclusions.push({ artistId: link.performance.artistId, scope, fingerprint: `${source.provider}:${source.externalId ?? source.url}` });
        for (const part of recording.parts) if (part.sha256) exclusions.push({ artistId: link.performance.artistId, scope, fingerprint: `sha256:${part.sha256}` });
      }
    }
  }
  await prisma.$transaction(async tx => {
    await tx.recording.update({ where: { id }, data: { deletionState: 'pending', deletionError: null,
      deletionNextAttemptAt: new Date(Date.now() + 5 * 60000), deletionTargets: JSON.stringify({ files: [...new Set(files)], targets, partIds: recording.parts.map(part => part.id), exclusions }) } });
    if (await tx.downloadQueueItem.count({ where: { recordingId: id, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } })) throw new LiveError('Finish or remove the active download before deleting');
  });
}
export async function processRecordingDeletions(now = new Date()) {
  const rows = await prisma.recording.findMany({ where: { deletionState: { in: ['pending', 'failed'] }, deletionNextAttemptAt: { lte: now } }, take: 20 });
  for (const row of rows) {
    try {
      const claimed = await prisma.recording.updateMany({ where: { id: row.id, deletionState: { in: ['pending', 'failed'] } }, data: { deletionState: 'running', deletionAttempts: { increment: 1 } } });
      if (!claimed.count) continue;
      const snapshot = snapshotSchema.parse(JSON.parse(row.deletionTargets ?? 'null'));
      if (await prisma.downloadQueueItem.count({ where: { recordingId: row.id, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } })) throw new LiveError('An acquisition is active; deletion deferred');
      const parts = await prisma.recordingPart.findMany({ where: { recordingId: row.id } });
      if (parts.some(part => !snapshot.partIds.includes(part.id) || (part.available && (!part.path || !snapshot.files.includes(part.path))))) throw new LiveError('Ownership changed since deletion was scheduled');
      for (const part of parts.filter(part => part.available)) {
        if (!part.path) throw new LiveError('Resolve the registered file location before deleting');
        if (await prisma.musicVideoFile.count({ where: { path: part.path, ...(row.musicVideoId ? { musicVideoId: { not: row.musicVideoId } } : {}) } })) throw new LiveError('Another music video owns this path; resolve ownership before deletion');
      }
      const copies = await prisma.recordingServerCopy.findMany({ where: { part: { recordingId: row.id } } });
      if (copies.some(copy => !snapshot.targets.some(target => target.connectorId === copy.connectorId && target.libraryId === copy.libraryId && target.externalId === copy.externalId && target.expectedPath === copy.expectedPath))) throw new LiveError('Server ownership changed after deletion was scheduled; review its targets before retrying');
      const remotes = [];
      for (const target of snapshot.targets) {
        const configured = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: target.connectorId } });
        if (configured.host !== target.host || configured.type !== target.type || !configured.enabled) throw new LiveError('Restore the original playback server before retrying deletion');
        const connector = { ...configured, videoLibraryId: target.libraryId };
        const provider = getLibraryConnectorProvider(connector.type);
        if (!provider.verifyVideoDeletion || !provider.deleteVideo || !provider.isVideoInUse) throw new LiveError('This playback server cannot verify deletion safely');
        await provider.verifyVideoDeletion(connector, target);
        if (await provider.isVideoInUse(connector, target.externalId)) throw new LiveError('Recording is playing or paused; deletion deferred');
        remotes.push({ connector, provider, target });
      }
      for (const file of snapshot.files) await checkLocalPath(file);
      // Recheck before any remote deletion: an older registration may contain
      // an alias, or ownership may have changed during the five-minute delay.
      await assertExclusiveLocalFiles(snapshot.files, { recordingId: row.id, musicVideoId: row.musicVideoId });
      for (const remote of remotes) await remote.provider.deleteVideo!(remote.connector, remote.target);
      for (const file of snapshot.files) { await checkLocalPath(file); await fs.unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
      await prisma.$transaction(async tx => {
        for (const exclusion of snapshot.exclusions) await tx.liveExclusion.upsert({ where: { fingerprint: exclusion.fingerprint }, create: exclusion, update: {} });
        await tx.recordingServerCopy.deleteMany({ where: { part: { recordingId: row.id } } });
        await tx.playlistItem.deleteMany({ where: { recordingPart: { recordingId: row.id } } });
        for (const part of parts) await tx.recordingPart.update({ where: { id: part.id }, data: { available: false, path: `deleted:${part.id}:${part.path}` } });
        await tx.recordingSource.deleteMany({ where: { recordingId: row.id } });
        if (row.musicVideoId) {
          await tx.recording.update({ where: { id: row.id }, data: { musicVideoId: null } });
          await tx.musicVideo.delete({ where: { id: row.musicVideoId } });
        }
        await tx.recording.update({ where: { id: row.id }, data: { deletionState: 'deleted', deletionNextAttemptAt: null, deletionTargets: null, reviewStatus: 'deleted' } });
        await tx.history.create({ data: { recordingId: row.id, eventType: 'deleted', data: JSON.stringify({ parts: snapshot.partIds.length }) } });
      });
    } catch (error) {
      await prisma.recording.updateMany({ where: { id: row.id }, data: { deletionState: 'failed', deletionError: redactMessage(error), deletionNextAttemptAt: new Date(now.getTime() + 40 * 60000) } });
      await logActivity('warn', 'recording-deletion', error);
    }
  }
  return `${rows.length} due recording deletions checked`;
}

export async function recoverRecordingDeletions() {
  await prisma.recording.updateMany({ where: { deletionState: 'running' }, data: { deletionState: 'failed', deletionError: 'Deletion interrupted; automatic retry scheduled', deletionNextAttemptAt: new Date(Date.now() + 40 * 60000) } });
}

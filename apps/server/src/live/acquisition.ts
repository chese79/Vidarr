import { storageIdentity } from '../media/storageIdentity.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DownloadQueueItem } from '@prisma/client';
import { prisma } from '../db/client.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import { assertHasVideoStream, assertHasMotion, assertMovingVideoSamples, assertFileIntegrity, getVideoProbe } from '../media/inspection.js';
import { stageImportBundle } from '../pipeline/importBundle.js';
import { accessibleRootPath } from '../pipeline/localVideoReview.js';
import { isPathWithinRoot } from '../pipeline/pathContainment.js';
import { wakeDownloadQueue } from '../pipeline/downloadDispatcher.js';
import { LiveError, directVideoUrl, liveConfiguration } from './policy.js';

export async function assertRecordingEligible(id: number) {
  const recording = await prisma.recording.findUniqueOrThrow({ where: { id }, include: { performances: { include: { performance: { select: { removedAt: true, artist: { select: { name: true } } } } } } } });
  if (recording.catalogType !== 'live' || !recording.identityVerified || !recording.videoVerified || recording.reviewStatus !== 'accepted' || recording.deletionState) throw new LiveError('Complete identity and video review before acquisition');
  if (!recording.performances.length || recording.performances.some(link => !link.identityVerified || link.performance.removedAt)) throw new LiveError('Review every linked event before acquiring this recording');
  return recording;
}
export async function enqueueRecording(recordingId: number, sourceId: number, downloadClientId?: number, packApproval?: { totalSizeBytes: number; contents: string[]; selected: string[]; approved: true }, partPosition = 1) {
  const recording = await assertRecordingEligible(recordingId);
  const source = await prisma.recordingSource.findFirstOrThrow({ where: { id: sourceId, recordingId, accepted: true, available: true } });
  const inspection = JSON.parse(source.payload).inspection;
  if (inspection?.currentlyLive || inspection?.sourceHasVideo === false) throw new LiveError('Wait for a completed moving-video recording; live streams and audio-only sources are ineligible');
  const { policy } = await liveConfiguration();
  const rootFolderId = recording.claimedCoverage === 'individualSong' ? policy.songRootFolderId : policy.fullRootFolderId;
  if (!rootFolderId) throw new LiveError('Choose the live destination folder in settings first');
  await prisma.rootFolder.findUniqueOrThrow({ where: { id: rootFolderId } });
  const indexer = source.provider.startsWith('indexer:');
  if (indexer && !downloadClientId) throw new LiveError('Choose a download client');
  // None of the current client adapters proves selective pack support. Explicit full-pack review is required.
  if (indexer && (!packApproval || packApproval.totalSizeBytes <= 0 || !packApproval.contents.length || !packApproval.selected.length
    || packApproval.selected.some(value => !packApproval.contents.includes(value)))) throw new LiveError('Review the complete pack size, contents and files to import before approving the full download');
  if (downloadClientId) await prisma.downloadClient.findUniqueOrThrow({ where: { id: downloadClientId, enabled: true } });
  const url = indexer ? source.url : directVideoUrl(source.url);
  const item = await prisma.$transaction(async tx => {
    const current = await tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
    if (current.deletionState || !current.identityVerified || !current.videoVerified) throw new LiveError('Recording changed; review it again');
    if (await tx.downloadQueueItem.count({ where: { recordingId, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } })) throw new LiveError('Recording already has an active download');
    return tx.downloadQueueItem.create({ data: { recordingId, recordingSourceId: source.id, rootFolderId, partPosition, sourceType: indexer ? 'indexer' : 'youtube', sourceRef: url,
      downloadClientId, status: 'queued', validationCategory: recording.claimedCoverage === 'individualSong' ? 'liveSong' : recording.claimedCoverage === 'unknown' ? 'liveUnknown' : 'liveFull',
      selectedFiles: packApproval ? JSON.stringify(packApproval) : null } });
  });
  wakeDownloadQueue(); return item;
}

export async function selectedRecordingFiles(contentPath: string, selection: string | null): Promise<string[]> {
  if (!selection) throw new LiveError('Pack selection is missing; retain the download for review');
  const approved = JSON.parse(selection) as { selected: string[] };
  const root = await fs.realpath(contentPath);
  const stat = await fs.lstat(root);
  if (stat.isFile()) {
    if (approved.selected.length !== 1 || path.basename(root) !== path.basename(approved.selected[0])) throw new LiveError('Downloaded file differs from the approved selection');
    return [root];
  }
  const files: string[] = [];
  for (const name of approved.selected) {
    if (path.isAbsolute(name) || name.split(/[\\/]/).some(value => value === '..')) throw new LiveError('Pack selection escaped its download folder');
    const candidate = path.resolve(root, name);
    if (!isPathWithinRoot(root, candidate)) throw new LiveError('Invalid pack path');
    const item = await fs.lstat(candidate);
    if (!item.isFile() || item.isSymbolicLink() || !isPathWithinRoot(root, await fs.realpath(candidate))) throw new LiveError('Pack file is missing or unsafe');
    files.push(candidate);
  }
  return files;
}

export async function importRecordingDownload(item: DownloadQueueItem) {
  if (!item.recordingId || !item.rootFolderId || !item.downloadedPath) throw new LiveError('Recording import target is incomplete');
  const recording = await assertRecordingEligible(item.recordingId);
  const root = await prisma.rootFolder.findUniqueOrThrow({ where: { id: item.rootFolderId } });
  const rootPath = await fs.realpath(await accessibleRootPath(root.path));
  const { policy } = await liveConfiguration(); // Freeze once for the entire multipart validation run.
  const checks = item.validationPolicy ? JSON.parse(item.validationPolicy) as { file: boolean; motion: boolean } : item.validationCategory === 'liveUnknown' ? { file: true, motion: true } : item.validationCategory === 'liveSong' ? policy.song : policy.full;
  if (!item.validationPolicy) await prisma.downloadQueueItem.update({ where: { id: item.id }, data: { validationPolicy: JSON.stringify(checks) } });
  const files = item.sourceType === 'indexer' ? await selectedRecordingFiles(item.downloadedPath, item.selectedFiles) : [item.downloadedPath];
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const existing = await prisma.recordingPart.findMany({ where: { recordingId: recording.id }, orderBy: { position: 'asc' } });
  const imported: { path: string; sizeBytes: bigint }[] = [];
  for (const [index, source] of files.entries()) {
    const position = item.partPosition + index;
    const done = existing.find(part => part.importedQueueId === item.id && part.position === position);
    if (done?.path && done.sizeBytes !== null) { imported.push({ path: done.path, sizeBytes: done.sizeBytes }); continue; }
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new LiveError('Import requires a regular video file');
    // Baseline video and non-static-content eligibility is mandatory even when optional deep checks are disabled.
    await assertHasVideoStream(source);
    if (checks.motion) await assertHasMotion(source); else await assertMovingVideoSamples(source);
    if (checks.file) await assertFileIntegrity(source);
    const probe = await getVideoProbe(source);
    if (!probe.duration) throw new LiveError('Duration could not be established; keep the file for validation recovery');
    const space = await fs.statfs(rootPath, { bigint: true });
    if (space.bavail * space.bsize - BigInt(stat.size) < BigInt(settings.minFreeSpaceMb) * 1024n * 1024n) throw new LiveError('Destination has insufficient free space');
    const hash = createHash('sha256'); for await (const chunk of createReadStream(source)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    const slot = existing.find(part => part.position === position);
    if (slot?.path && slot.sha256 === sha256 && slot.sizeBytes !== null) { imported.push({ path: slot.path, sizeBytes: slot.sizeBytes }); continue; }
    if (slot?.path && await fs.stat(slot.path).then(stat => stat.isFile(), () => false)) throw new LiveError('This part already has a retained file; create another recording version or choose the next part position rather than replacing it');
    if (slot?.legacyMusicVideoFileId && !slot.path) throw new LiveError('Resolve the legacy file ownership conflict before importing this part');
    const destination = path.join(rootPath, `Recording ${recording.id}`, `Part ${position}${path.extname(source).toLowerCase()}`);
    if (!isPathWithinRoot(rootPath, destination)) throw new LiveError('Destination escaped its root');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (!isPathWithinRoot(rootPath, await fs.realpath(path.dirname(destination)))) throw new LiveError('Destination directory escaped through a symlink');
    if (await fs.lstat(destination).then(() => true, () => false)) throw new LiveError('Unregistered destination exists; retain both files for recovery');
    if (await prisma.liveExclusion.count({ where: { fingerprint: `sha256:${sha256}` } })) throw new LiveError('This exact recording was excluded from future imports');
    if (files.length === 1) {
      const identical = await prisma.recordingPart.findFirst({ where: { sha256, available: true, recordingId: { not: recording.id } }, include: { recording: { include: { performances: true, parts: true } } } });
      if (identical?.path && identical.sizeBytes !== null && identical.recording.parts.length === 1) {
        const links = await prisma.recordingPerformance.findMany({ where: { recordingId: recording.id } });
        if (links.some(link => !identical.recording.performances.some(other => other.performanceId === link.performanceId))) throw new LiveError('An identical file is associated with another performance; review the conflicting identity before linking');
        await prisma.$transaction(async tx => {
          await tx.downloadQueueItem.update({ where: { id: item.id }, data: { recordingSourceId: null } });
          await tx.recordingSource.updateMany({ where: { recordingId: recording.id }, data: { recordingId: identical.recordingId } });
          await tx.recording.update({ where: { id: recording.id }, data: { reviewStatus: 'identifiedDuplicate', evidence: JSON.stringify({ previous: JSON.parse(recording.evidence), duplicateOf: identical.recordingId, sha256 }) } });
          await tx.history.create({ data: { recordingId: recording.id, eventType: 'downloadFolderImported', data: JSON.stringify({ queueId: item.id, path: identical.path, duplicateOf: identical.recordingId }) } });
        });
        return { path: identical.path, sizeBytes: identical.sizeBytes };
      }
    }
    const artistName = [...new Set(recording.performances.map(link => link.performance.artist.name))].join(', ');
    const bundle = await stageImportBundle(source, destination, 'copy', { artistName, title: recording.title, year: null, director: null, thumbnailUrl: null });
    try {
      await prisma.$transaction(async tx => {
        const data = { rootFolderId: root.id, path: destination, available: true, sizeBytes: BigInt(stat.size), storageIdentity: await storageIdentity(rootPath, true), sha256, durationSeconds: probe.duration, importedQueueId: item.id };
        if (slot) await tx.recordingPart.update({ where: { id: slot.id }, data });
        else await tx.recordingPart.create({ data: { recordingId: recording.id, position, ...data } });
        await tx.recording.update({ where: { id: recording.id }, data: { resolution: recording.resolution == null ? probe.height : Math.min(recording.resolution, probe.height) } });
        await tx.history.create({ data: { recordingId: recording.id, eventType: 'recordingPartImported', data: JSON.stringify({ queueId: item.id, position, path: destination }) } });
      });
    } catch (error) { await bundle.rollback(); throw error; }
    await bundle.commit();
    imported.push({ path: destination, sizeBytes: BigInt(stat.size) });
  }
  await prisma.history.create({ data: { recordingId: recording.id, eventType: 'downloadFolderImported', data: JSON.stringify({ queueId: item.id, paths: imported.map(part => part.path), path: imported[0].path }) } });
  return imported[0];
}

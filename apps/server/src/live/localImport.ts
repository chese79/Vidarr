import { storageIdentity } from '../media/storageIdentity.js';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import type { LibraryConnector } from '@prisma/client';
import { prisma } from '../db/client.js';
import { assertHasVideoStream, assertHasMotion, assertMovingVideoSamples, assertFileIntegrity, getVideoProbe } from '../media/inspection.js';
import { accessibleRootPath } from '../pipeline/localVideoReview.js';
import { isPathWithinRoot } from '../pipeline/pathContainment.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { LiveError, liveConfiguration } from './policy.js';
import { assertRecordingEligible } from './acquisition.js';

export async function registerExistingRecordingFile(recordingId: number, rootFolderId: number, filePath: string) {
  const recording = await assertRecordingEligible(recordingId);
  const root = await prisma.rootFolder.findUniqueOrThrow({ where: { id: rootFolderId } });
  const realRoot = await fs.realpath(await accessibleRootPath(root.path));
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || !isPathWithinRoot(realRoot, await fs.realpath(filePath))) throw new LiveError('Choose a regular file inside the accessible configured media root');
  const { policy } = await liveConfiguration();
  const checks = recording.claimedCoverage === 'unknown' ? { file: true, motion: true } : recording.claimedCoverage === 'individualSong' ? policy.song : policy.full;
  await assertHasVideoStream(filePath);
  if (checks.file) await assertFileIntegrity(filePath);
  if (checks.motion) await assertHasMotion(filePath); else await assertMovingVideoSamples(filePath);
  const probe = await getVideoProbe(filePath);
  if (!probe.duration) throw new LiveError('Unable to establish file duration; retain it for review');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const sha256 = hash.digest('hex'), identity = await storageIdentity(realRoot, true);
  if (await prisma.liveExclusion.count({ where: { fingerprint: `sha256:${sha256}` } })) throw new LiveError('This exact recording was excluded from future imports');
  return prisma.$transaction(async tx => {
    const current = await tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
    if (current.deletionState) throw new LiveError('Deletion is pending');
    const existing = await tx.recordingPart.findUnique({ where: { path: filePath } });
    if (existing) {
      if (existing.recordingId !== recordingId) throw new LiveError('This file already belongs to another recording; link that recording instead');
      return existing;
    }
    if (await tx.musicVideoFile.count({ where: { path: filePath } })) throw new LiveError('This file belongs to a music video; use the reversible classification workflow');
    const last = await tx.recordingPart.aggregate({ where: { recordingId }, _max: { position: true } });
    const part = await tx.recordingPart.create({ data: { recordingId, rootFolderId, path: filePath, sizeBytes: BigInt(stat.size), storageIdentity: identity, durationSeconds: probe.duration, sha256, position: (last._max.position ?? 0) + 1 } });
    await tx.history.create({ data: { recordingId, eventType: 'existingFileRegistered', data: JSON.stringify({ partId: part.id, path: filePath, moved: false, checks }) } });
    return part;
  });
}
export async function recordingServerCandidates(connector: LibraryConnector, search: string, offset = 0) {
  const provider = getLibraryConnectorProvider(connector.type);
  if (!provider.fetchVideos) throw new LiveError('This connector cannot discover video inventory');
  const videos = await provider.fetchVideos(connector);
  const matches = videos.filter(video => `${video.artistName} ${video.title}`.toLowerCase().includes(search.toLowerCase()));
  return { total: matches.length, items: matches.slice(offset, offset + 25), offset, limit: 25 };
}

export async function registerServerRecording(recordingId: number, connectorId: number, externalId: string, rootFolderId: number) {
  await assertRecordingEligible(recordingId);
  const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
  if (!connector.enabled || !connector.videoLibraryId) throw new LiveError('Choose an enabled playback library');
  const provider = getLibraryConnectorProvider(connector.type);
  if (!provider.fetchVideos) throw new LiveError('The connector cannot verify video inventory');
  const items = await provider.fetchVideos(connector), matches = items.filter(item => item.externalId === externalId);
  if (matches.length !== 1 || !matches[0].path) throw new LiveError('The exact video and path must be present in the selected playback library');
  const item = matches[0];
  await prisma.rootFolder.findUniqueOrThrow({ where: { id: rootFolderId } });
  return prisma.$transaction(async tx => {
    if (await tx.libraryVideo.count({ where: { connectorId, externalId, musicVideoId: { not: null }, matchConfidence: null } })) throw new LiveError('This server item belongs to a music video; use its live classification review');
    const duplicate = await tx.recordingServerCopy.findUnique({ where: { connectorId_libraryId_externalId: { connectorId, libraryId: connector.videoLibraryId!, externalId } } });
    if (duplicate) throw new LiveError('This server video is already linked to a recording');
    const recording = await tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
    if (recording.deletionState) throw new LiveError('Deletion is pending');
    const last = await tx.recordingPart.aggregate({ where: { recordingId }, _max: { position: true } });
    const part = await tx.recordingPart.create({ data: { recordingId, position: (last._max.position ?? 0) + 1,
      available: false, durationSeconds: item.durationSeconds,
      serverCopies: { create: { connectorId, libraryId: connector.videoLibraryId!, externalId, expectedPath: item.path!, playCount: item.playCount } } } });
    await tx.history.create({ data: { recordingId, eventType: 'serverRecordingRegistered', data: JSON.stringify({ partId: part.id, connectorId, externalId }) } });
    return part;
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { getVideoProbe, assertHasVideoStream } from '../media/inspection.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import { checkLocalPath } from '../pipeline/deleteVideo.js';
import { LiveError } from './policy.js';

export async function classifyExistingVideo(musicVideoId: number, performanceId: number, videoVerified: boolean) {
  if (!videoVerified) throw new LiveError('Review the performer, event identity and actual video before confirming classification');
  const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id: musicVideoId }, include: { file: true, artist: true } });
  if (!video.isLiveConcert || video.deletionState || video.artist.musicbrainzMatchStatus !== 'confirmed') throw new LiveError('Choose a flagged video with a confirmed artist and no pending deletion');
  let durationSeconds = video.durationSeconds;
  if (video.file) {
    await checkLocalPath(video.file.path); await fs.stat(video.file.path); await assertHasVideoStream(video.file.path);
    durationSeconds = (await getVideoProbe(video.file.path)).duration || durationSeconds;
  }
  return prisma.$transaction(async tx => {
    // Acquire the SQLite write reservation before checking the acquisition/classification state.
    await tx.musicVideo.update({ where: { id: musicVideoId }, data: { isLiveConcert: true } });
    const performance = await tx.livePerformance.findUniqueOrThrow({ where: { id: performanceId } });
    if (performance.artistId !== video.artistId) throw new LiveError('Choose a performance credited to the same confirmed artist');
    if (await tx.downloadQueueItem.count({ where: { musicVideoId, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } })) throw new LiveError('Finish or resolve the active download before reclassifying');
    const previous = await tx.recording.findFirst({ where: { musicVideoId }, include: { parts: true } });
    if (previous && previous.catalogType !== 'musicVideo' && previous.reviewStatus !== 'returnedToMusicVideos') throw new LiveError('This video already has a recording classification');
    const recording = previous ? await tx.recording.update({ where: { id: previous.id }, data: { catalogType: 'live', reviewStatus: 'accepted', identityVerified: true, videoVerified: true, evidence: JSON.stringify({ ...JSON.parse(previous.evidence), originalCatalogKind: video.catalogKind, existingQualifiedPlays: video.qualifiedPlayCount, existingNativePlays: video.file?.playCount ?? null }),
      performances: { connectOrCreate: { where: { recordingId_performanceId: { recordingId: previous.id, performanceId } }, create: { performanceId, identityVerified: true } } } } })
      : await tx.recording.create({ data: { musicVideoId, title: video.title, reviewStatus: 'accepted', identityVerified: true, videoVerified: true,
      evidence: JSON.stringify({ originalCatalogKind: video.catalogKind, existingVideoId: video.id, existingQualifiedPlays: video.qualifiedPlayCount }),
      performances: { create: { performanceId, identityVerified: true } } } });
    if (video.file) {
      const oldPart = previous?.parts.find(part => part.legacyMusicVideoFileId === video.file!.id);
      if (oldPart && (oldPart.path !== video.file.path || oldPart.sizeBytes !== video.file.sizeBytes)) await tx.recordingCoverage.updateMany({ where: { partId: oldPart.id }, data: { verified: false, fullSong: false } });
      const part = await tx.recordingPart.upsert({ where: { legacyMusicVideoFileId: video.file.id }, create: { recordingId: recording.id, position: 1, rootFolderId: video.artist.rootFolderId,
        path: video.file.path, sizeBytes: video.file.sizeBytes, legacyMusicVideoFileId: video.file.id, durationSeconds }, update: { path: video.file.path, sizeBytes: video.file.sizeBytes, durationSeconds } });
      for (const copy of await tx.libraryVideo.findMany({ where: { musicVideoId, available: true, matchConfidence: null }, include: { connector: true } })) {
        if (!copy.path || !copy.connector.videoLibraryId) continue;
        await tx.recordingServerCopy.upsert({ where: { partId_connectorId: { partId: part.id, connectorId: copy.connectorId } }, create: { partId: part.id, connectorId: copy.connectorId, libraryId: copy.connector.videoLibraryId,
          externalId: copy.externalId, expectedPath: copy.path, playCount: copy.playCount }, update: { libraryId: copy.connector.videoLibraryId, externalId: copy.externalId, expectedPath: copy.path, available: true } });
      }
    } else {
      const copies = await tx.libraryVideo.findMany({ where: { musicVideoId, available: true, matchConfidence: null }, include: { connector: true } });
      const part = previous?.parts[0] ?? await tx.recordingPart.create({ data: { recordingId: recording.id, position: 1, available: false } });
      const connectorIds = new Set<number>();
      for (const copy of copies) {
        if (!copy.path || !copy.connector.videoLibraryId) continue;
        if (connectorIds.has(copy.connectorId)) throw new LiveError('Several server versions match this video; resolve their recording identity before classification');
        connectorIds.add(copy.connectorId);
        await tx.recordingServerCopy.upsert({ where: { partId_connectorId: { partId: part.id, connectorId: copy.connectorId } }, create: {
          partId: part.id, connectorId: copy.connectorId, libraryId: copy.connector.videoLibraryId, externalId: copy.externalId, expectedPath: copy.path, playCount: copy.playCount,
        }, update: { libraryId: copy.connector.videoLibraryId, externalId: copy.externalId, expectedPath: copy.path, available: true } });
      }
    }
    await tx.recordingPerformance.updateMany({ where: { recordingId: recording.id, performanceId }, data: { identityVerified: true } });
    // Preserve the legacy identity as the compatibility owner for files, historic counts and playlist references.
    await tx.musicVideo.update({ where: { id: musicVideoId }, data: { catalogKind: 'liveClassified' } });
    await tx.history.create({ data: { musicVideoId, eventType: 'classifiedLive', data: JSON.stringify({ recordingId: recording.id, performanceId }) } });
    return recording;
  });
}
export async function returnToMusicVideos(recordingId: number, officialMusicVideoConfirmed: boolean) {
  if (!officialMusicVideoConfirmed) throw new LiveError('Confirm normal artist, official song-video and content eligibility before returning to Music Videos');
  return prisma.$transaction(async tx => {
    const recording = await tx.recording.findUniqueOrThrow({ where: { id: recordingId }, include: { parts: { include: { coverage: true, playlistItems: true } } } });
    if (!recording.musicVideoId || recording.deletionState) throw new LiveError('Choose a reversible existing-video classification');
    const video = await tx.musicVideo.findUniqueOrThrow({ where: { id: recording.musicVideoId }, include: { artist: true, file: true } });
    if (video.deletionState) throw new LiveError('Music-video deletion is pending; resolve it before changing classification');
    if (video.artist.musicbrainzMatchStatus !== 'confirmed' || !video.artist.musicbrainzArtistId) throw new LiveError('Confirm the shared artist identity first');
    if (await tx.downloadQueueItem.count({ where: { recordingId, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } })) throw new LiveError('Finish live acquisition first');
    const newFiles = recording.parts.filter(part => !part.legacyMusicVideoFileId && part.path !== null && part.available);
    if (newFiles.length && (newFiles.length !== 1 || recording.parts.length !== 1 || video.file)) throw new LiveError('Choose one eligible music-video file and reassign additional parts before returning this entry');
    if (newFiles.length) {
      const part = newFiles[0], stat = await fs.lstat(part.path!);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new LiveError('Restore the registered video file before returning it');
      await tx.musicVideoFile.create({ data: { musicVideoId: video.id, path: part.path!, sizeBytes: BigInt(stat.size), originalFilename: path.basename(part.path!) } });
      await tx.recordingPart.update({ where: { id: part.id }, data: { rootFolderId: part.rootFolderId } });
      await tx.musicVideo.update({ where: { id: video.id }, data: { hasFile: true, awaitingServerScanAt: new Date() } });
    }
    for (const part of recording.parts) {
      const items = await tx.playlistItem.findMany({ where: { recordingPartId: part.id } });
      for (const item of items) {
        const existing = await tx.playlistItem.findUnique({ where: { playlistId_musicVideoId: { playlistId: item.playlistId, musicVideoId: video.id } } });
        if (existing) await tx.playlistItem.delete({ where: { id: item.id } });
        else await tx.playlistItem.update({ where: { id: item.id }, data: { musicVideoId: video.id, recordingPartId: null, songId: null } });
      }
    }
    const original = JSON.parse(recording.evidence).originalCatalogKind;
    await tx.musicVideo.update({ where: { id: video.id }, data: { isLiveConcert: false, catalogKind: ['official', 'supplementary'].includes(original) ? original : 'supplementary' } });
    await tx.recording.update({ where: { id: recordingId }, data: { catalogType: 'musicVideo', reviewStatus: 'returnedToMusicVideos', identityVerified: false, videoVerified: false } });
    return { musicVideoId: video.id };
  });
}

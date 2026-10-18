import { prisma } from '../db/client.js';
import { LiveError } from './policy.js';

export async function addRecordingToPlaylist(playlistId: number, partId: number, songId?: number, fullRecordingFallback = false) {
  return prisma.$transaction(async tx => {
    const playlist = await tx.playlist.findUniqueOrThrow({ where: { id: playlistId } });
    if (playlist.kind !== 'static') throw new LiveError('Add live recordings to a static playlist');
    const part = await tx.recordingPart.findUniqueOrThrow({ where: { id: partId }, include: { recording: true, serverCopies: { include: { connector: true } }, coverage: true } });
    if (part.recording.catalogType !== 'live' || part.recording.deletionState || part.recording.reviewStatus !== 'accepted' || !part.recording.identityVerified || !part.recording.videoVerified) throw new LiveError('Choose a reviewed eligible recording without pending deletion');
    if (!playlist.targetConnectorId || !part.serverCopies.some(copy => copy.connectorId === playlist.targetConnectorId && copy.available && copy.connector.enabled
      && copy.libraryId === copy.connector.videoLibraryId)) throw new LiveError('Choose a playlist bound to the confirmed playback library for this file');
    if (songId && !part.coverage.some(item => item.songId === songId && item.verified && item.fullSong)) throw new LiveError('Verify this song occurrence and its boundaries first');
    // Connector APIs publish whole items. A bounded segment must not silently turn into a concert.
    if (songId && !fullRecordingFallback) throw new LiveError('This server cannot publish bounded segments. Explicitly approve the whole-recording fallback or select an existing song clip');
    if (await tx.playlistItem.count({ where: { playlistId, recordingPartId: partId, songId: songId ?? null } })) throw new LiveError('Recording is already in this playlist');
    const order = await tx.playlistItem.aggregate({ where: { playlistId }, _max: { sortOrder: true } });
    return tx.playlistItem.create({ data: { playlistId, recordingPartId: partId, songId, fullRecordingFallback, sortOrder: (order._max.sortOrder ?? -1) + 1 } });
  });
}

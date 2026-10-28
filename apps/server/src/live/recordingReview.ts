import { z } from 'zod';
import { prisma } from '../db/client.js';
import { LiveError } from './policy.js';
import { liveScanExcluded } from './exclusions.js';
import { exactLiveMatch } from './evidence.js';

export async function reviewRecording(id: number, input: unknown) {
    const body = z.object({ action: z.enum(['confirm', 'independent', 'reject', 'automatic']), performanceId: z.number().int().positive(),
      videoVerified: z.boolean(), artistMbid: z.string().optional(), performanceDate: z.string().optional(), venueId: z.string().optional(), venue: z.string().optional(), song: z.string().optional(),
      conflicts: z.array(z.string()).default([]), songId: z.number().int().positive().optional(), notes: z.string().max(10000).default('') }).strict().parse(input);
    return prisma.$transaction(async tx => {
      const recording = await tx.recording.findUniqueOrThrow({ where: { id, catalogType: 'live' }, include: { performances: true, parts: true } });
      if (recording.catalogType === 'musicVideo' || recording.reviewStatus === 'returnedToMusicVideos') throw new LiveError('Use the music video classification review to return this entry to Live');
      const target = await tx.livePerformance.findUniqueOrThrow({ where: { id: body.performanceId }, include: { artist: true, songs: true } });
      if (body.action !== 'reject' && await liveScanExcluded([`artistSet:${target.artistId}:${target.id}`, ...(body.songId ? [`rendition:${body.songId}`] : [])], tx)) throw new LiveError('This performance or rendition is excluded from future scans; remove that exclusion before accepting it');
      if (body.songId && !target.songs.some(song => song.id === body.songId)) throw new LiveError('Choose a song occurrence in this performance');
      if (target.removedAt) throw new LiveError('Restore this performance before accepting a recording');
      if (body.action !== 'reject' && (target.artist.musicbrainzMatchStatus !== 'confirmed' || !target.artist.musicbrainzArtistId)) throw new LiveError('Confirm the shared MusicBrainz artist before accepting this recording');
      const auto = Boolean(target.setlistFmId) && target.identityStatus !== 'correctionPending' && target.artist.musicbrainzMatchStatus === 'confirmed' && Boolean(target.artist.musicbrainzArtistId)
        && exactLiveMatch(body, { ...target, artistMbid: target.artist.musicbrainzArtistId ?? '' });
      if (body.action === 'automatic' && !auto) throw new LiveError('Date, venue, artist and song must all agree without conflicts for automatic confirmation');
      if (body.action !== 'reject' && !body.videoVerified) throw new LiveError('Confirm actual moving video; audio-only and static-image recordings are excluded');
      if (recording.deletionState) throw new LiveError('Recording deletion is pending');
      if (recording.reviewStatus === 'pending' && recording.performances.length === 1 && recording.performances[0].performanceId !== target.id && !recording.parts.length)
        await tx.recordingPerformance.deleteMany({ where: { recordingId: id } });
      await tx.recordingPerformance.upsert({ where: { recordingId_performanceId: { recordingId: id, performanceId: target.id } }, create: { recordingId: id, performanceId: target.id, identityVerified: body.action !== 'reject' }, update: { identityVerified: body.action !== 'reject' } });
      const allConfirmed = !await tx.recordingPerformance.count({ where: { recordingId: id, identityVerified: false } });
      await tx.history.create({ data: { recordingId: id, eventType: 'liveIdentityReviewed', data: JSON.stringify(body) } });
      return tx.recording.update({ where: { id }, data: { reviewStatus: body.action === 'reject' ? 'rejected' : 'accepted',
        identityVerified: body.action !== 'reject' && allConfirmed, videoVerified: body.videoVerified && body.action !== 'reject',
        evidence: JSON.stringify({ ...JSON.parse(recording.evidence), review: body, automaticEligible: auto }) } });
    });
}


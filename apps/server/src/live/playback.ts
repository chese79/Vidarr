import type { LibraryPlaybackSession } from '../providers/library/types.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { baseUrl } from '../providers/library/util.js';
import { prisma, logActivity } from '../db/client.js';
import { observedPlaybackSeconds } from '../media/playback.js';
import { LiveError } from './policy.js';
export function playbackServerKey(type: string, host: string) { const url = new URL(baseUrl(host)); return JSON.stringify([type, url.origin + url.pathname.replace(/\/+$/, '')]); }

export async function observeLivePlayback(serverKey: string, partId: number, session: LibraryPlaybackSession, now = new Date()) {
  // Anonymous server sessions cannot safely be joined across devices.
  if (!session.userId || !Number.isFinite(session.positionSeconds) || session.positionSeconds < 0) return;
  await prisma.$transaction(async tx => {
    const part = await tx.recordingPart.findUniqueOrThrow({ where: { id: partId }, include: { coverage: { where: { verified: true } }, recording: { include: { performances: true } } } });
    for (const link of part.recording.performances) {
      let view = await tx.liveViewing.findFirst({ where: { serverKey, userId: session.userId!, performanceId: link.performanceId, active: true }, orderBy: { id: 'desc' } });
      if (!view) view = await tx.liveViewing.create({ data: { serverKey, userId: session.userId!, performanceId: link.performanceId } });
      const key = JSON.stringify([serverKey, session.userId, session.sessionId, link.performanceId]);
      const previous = await tx.livePlaybackObservation.findUnique({ where: { key } });
      let credit = previous?.partId === partId && previous.viewingId === view.id ? observedPlaybackSeconds(previous, session, now) : 0;
      if (view.lastCreditAt) credit = Math.min(credit, Math.max(0, (now.getTime() - view.lastCreditAt.getTime()) / 1000));
      const observedCredit = credit;
      const relevant = part.coverage.filter(item => item.startSeconds != null && item.endSeconds != null);
      const songs = await tx.liveSongPerformance.findMany({ where: { performanceId: link.performanceId } });
      const songIds = new Set(songs.map(song => song.id));
      // Compilations only credit the event's verified intervals, never every linked event.
      if (part.recording.performances.length > 1) {
        const intervals = relevant.filter(item => songIds.has(item.songId)).map(item => [Math.max(session.positionSeconds - observedCredit, item.startSeconds!), Math.min(session.positionSeconds, item.endSeconds!)] as const)
          .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
        credit = 0; let coveredUntil = -Infinity;
        for (const [start, end] of intervals) { credit += Math.max(0, end - Math.max(start, coveredUntil)); coveredUntil = Math.max(coveredUntil, end); }
      }
      const watchedSeconds = view.watchedSeconds + credit;
      const full = part.recording.uninterruptedVerified && part.recording.claimedCoverage === 'entirePerformance' && part.recording.identityVerified && part.recording.videoVerified;
      const duration = full && part.recording.performances.length === 1 ? await tx.recordingPart.aggregate({ where: { recordingId: part.recordingId, OR: [{ available: true }, { serverCopies: { some: { available: true } } }] }, _sum: { durationSeconds: true } }).then(value => value._sum.durationSeconds) : view.durationSeconds;
      const qualified = duration != null && duration > 0 && watchedSeconds >= Math.min(duration / 2, 1800);
      const finalPart = full ? await tx.recordingPart.findFirst({ where: { recordingId: part.recordingId }, orderBy: { position: 'desc' } }) : null;
      const ended = full && finalPart?.id === partId && credit > 0 && part.durationSeconds != null && session.positionSeconds >= part.durationSeconds;
      await tx.liveViewing.update({ where: { id: view.id }, data: { ...(ended ? { completedAt: now, active: false } : {}), watchedSeconds, durationSeconds: duration, positionSeconds: session.positionSeconds, partId,
        ...(credit > 0 ? { lastCreditAt: now } : {}), ...(qualified && !view.qualifiedAt ? { qualifiedAt: now } : {}) } });
      if (qualified && !view.qualifiedAt) await tx.livePerformance.update({ where: { id: link.performanceId }, data: { qualifiedPlayCount: { increment: 1 } } });
      for (const item of relevant.filter(item => songIds.has(item.songId) && item.fullSong)) {
        const start = item.startSeconds!, end = item.endSeconds!;
        const overlap = observedCredit > 0 ? Math.max(0, Math.min(session.positionSeconds, end) - Math.max(session.positionSeconds - observedCredit, start)) : 0;
        const prior = await tx.liveSongViewing.findUnique({ where: { viewingId_songId: { viewingId: view.id, songId: item.songId } } });
        const seconds = (prior?.watchedSeconds ?? 0) + overlap, threshold = Math.min((end - start) / 2, 240);
        const earned = seconds >= threshold;
        await tx.liveSongViewing.upsert({ where: { viewingId_songId: { viewingId: view.id, songId: item.songId } }, create: { viewingId: view.id, songId: item.songId,
          watchedSeconds: seconds, durationSeconds: end - start, qualifiedAt: earned ? now : null }, update: { watchedSeconds: seconds, qualifiedAt: prior?.qualifiedAt ?? (earned ? now : null) } });
        if (earned && !prior?.qualifiedAt) await tx.liveSongPerformance.update({ where: { id: item.songId }, data: { qualifiedPlayCount: { increment: 1 } } });
      }
      await tx.livePlaybackObservation.upsert({ where: { key }, create: { key, viewingId: view.id, partId, positionSeconds: session.positionSeconds, playing: session.playing, lastObservedAt: now },
        update: { viewingId: view.id, partId, positionSeconds: session.positionSeconds, playing: session.playing, lastObservedAt: now } });
    }
  });
}
let running: Promise<string> | undefined;
export function pollLivePlayback() { return running ??= poll().finally(() => { running = undefined; }); }
async function poll() {
  const copies = await prisma.recordingServerCopy.findMany({ where: { available: true, connector: { enabled: true }, part: { recording: { reviewStatus: 'accepted', identityVerified: true, videoVerified: true, deletionState: null } } }, select: { connectorId: true, libraryId: true }, distinct: ['connectorId', 'libraryId'] });
  const seen = new Set<string>(); let observed = 0;
  for (const copy of copies) {
    const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: copy.connectorId } });
    const serverKey = playbackServerKey(connector.type, connector.host);
    try {
      const provider = getLibraryConnectorProvider(connector.type);
      const sessions = await provider.fetchPlaybackSessions?.({ ...connector, videoLibraryId: copy.libraryId }) ?? [];
      for (const session of sessions) {
        const matches = await prisma.recordingServerCopy.findMany({ where: { connectorId: connector.id, libraryId: copy.libraryId, externalId: session.externalId, available: true } });
        if (matches.length !== 1) continue;
        const key = JSON.stringify([serverKey, session.userId, session.sessionId, matches[0].partId]);
        if (seen.has(key)) continue; seen.add(key);
        await observeLivePlayback(serverKey, matches[0].partId, session); observed++;
      }
    } catch (error) { await logActivity('warn', 'live-playback', error); }
  }
  return `${observed} live playback observations; unfinished viewing retained`;
}
export async function changeViewing(id: number, action: 'startAgain' | 'markFinished') {
  const view = await prisma.liveViewing.findUniqueOrThrow({ where: { id } });
  if (!view.active) throw new LiveError('This viewing has already finished');
  await prisma.liveViewing.update({ where: { id }, data: { active: false, completedAt: action === 'markFinished' ? new Date() : view.completedAt } });
  // Neither action invents watched time or a play. The next observation starts a separate viewing.
  return { ok: true };
}

import { createHash } from 'node:crypto';
import type { LibraryConnector } from '@prisma/client';
import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { isNotFound } from '../providers/library/util.js';
import { redactMessage } from '../security/redact.js';

export const playbackScope = (connector: LibraryConnector) => createHash('sha256').update(JSON.stringify([
  connector.type, connector.host, connector.authToken, connector.userId, connector.videoLibraryId,
])).digest('hex');
const identity = (id: string | null | undefined) => id?.replace(/-/g, '').toLowerCase();
let active: Promise<string> | undefined;
export function pollPlaybackMonitor(now = new Date()): Promise<string> {
  return active ??= poll(now).finally(() => { active = undefined; });
}

async function eligibleCopies(connector: LibraryConnector, externalIds: string[]) {
  const videos = await prisma.libraryVideo.findMany({ where: { connectorId: connector.id,
    libraryId: connector.videoLibraryId, available: true, externalId: { in: externalIds } } });
  const live = await prisma.recordingServerCopy.findMany({ where: { connectorId: connector.id,
    libraryId: connector.videoLibraryId!, available: true, externalId: { in: externalIds },
    part: { recording: { reviewStatus: 'accepted', identityVerified: true, videoVerified: true, deletionState: null } } },
    include: { part: { select: { recordingId: true } } } });
  const uniqueLive = live.filter(copy => live.filter(other => other.externalId === copy.externalId)
    .every(other => other.part.recordingId === copy.part.recordingId));
  return { videos: new Map(videos.map(video => [video.externalId, video])), live: new Map(uniqueLive.map(copy => [copy.externalId, copy])) };
}

async function poll(now: Date): Promise<string> {
  const connectors = await prisma.libraryConnector.findMany({ where: {
    enabled: true, type: 'jellyfin', userId: { not: null }, videoLibraryId: { not: null },
  } });
  const ids = connectors.map(connector => connector.id);
  await prisma.playbackObservation.deleteMany({ where: { connectorId: { notIn: ids } } });
  await prisma.playCountRefresh.deleteMany({ where: { connectorId: { notIn: ids } } });
  let observed = 0, refreshed = 0, failures = 0;
  for (const connector of connectors) {
    const scope = playbackScope(connector);
    await prisma.playbackObservation.deleteMany({ where: { connectorId: connector.id, scope: { not: scope } } });
    await prisma.playCountRefresh.deleteMany({ where: { connectorId: connector.id, scope: { not: scope } } });
    const provider = getLibraryConnectorProvider(connector.type);
    let sessionFailed = false;
    try {
      const sessions = await provider.fetchActiveVideoSessions!(connector);
      const previous = await prisma.playbackObservation.findMany({ where: { connectorId: connector.id, scope } });
      const copies = await eligibleCopies(connector, [...new Set([...sessions.map(session => session.externalId), ...previous.map(session => session.externalId)])]);
      const current = sessions.filter(session => session.userId && Number.isFinite(session.positionSeconds)
        && session.positionSeconds >= 0 && (copies.videos.has(session.externalId) || copies.live.has(session.externalId)));
      const bySession = new Map(current.map(session => [session.sessionId, session]));
      await prisma.$transaction(async tx => {
        const latest = await tx.libraryConnector.findUnique({ where: { id: connector.id } });
        if (!latest?.enabled || playbackScope(latest) !== scope) return;
        for (const old of previous) {
          const next = bySession.get(old.sessionId);
          const changed = !next || next.externalId !== old.externalId || identity(next.userId) !== identity(old.userId)
            || next.positionSeconds < 5 && old.positionSeconds > next.positionSeconds + 15;
          if (changed && identity(old.userId) === identity(connector.userId)
            && (copies.videos.has(old.externalId) || copies.live.has(old.externalId))) {
            const baselineCount = copies.videos.get(old.externalId)?.playCount ?? copies.live.get(old.externalId)?.playCount ?? null;
            const data = { scope, baselineCount, lastCount: null, attempts: 0, nextAttemptAt: now, lastError: null };
            await tx.playCountRefresh.upsert({ where: { connectorId_externalId_userId: {
              connectorId: connector.id, externalId: old.externalId, userId: connector.userId!,
            } }, create: { connectorId: connector.id, externalId: old.externalId, userId: connector.userId!, ...data }, update: data });
          }
        }
        await tx.playbackObservation.deleteMany({ where: { connectorId: connector.id, sessionId: { notIn: current.map(session => session.sessionId) } } });
        for (const session of current) {
          const video = copies.videos.get(session.externalId);
          const data = { scope, userId: session.userId!, externalId: session.externalId,
            title: session.title ?? video?.title ?? 'Live recording', artistName: session.artistName ?? video?.artistName ?? null,
            userName: session.userName ?? null, deviceName: session.deviceName ?? null,
            positionSeconds: session.positionSeconds, playing: session.playing, lastSeenAt: now };
          await tx.playbackObservation.upsert({ where: { connectorId_sessionId: { connectorId: connector.id, sessionId: session.sessionId } },
            create: { connectorId: connector.id, sessionId: session.sessionId, ...data }, update: data });
        }
      }, { maxWait: 10_000, timeout: 30_000 });
      observed += current.length;
    } catch (error) {
      sessionFailed = true; failures++;
      await logActivity('warn', `playback-monitor:${connector.id}`, error);
    }
    // A full inventory sync owns its video snapshot until it commits. Retain
    // item refreshes, then read fresh native counts after that snapshot finishes.
    if (connector.videoSyncRunning || sessionFailed) continue;
    const pending = await prisma.playCountRefresh.findMany({ where: { connectorId: connector.id, scope, nextAttemptAt: { lte: now } }, orderBy: { id: 'asc' }, take: 1 });
    for (const item of pending) {
      const copies = await eligibleCopies(connector, [item.externalId]);
      if (!copies.videos.has(item.externalId) && !copies.live.has(item.externalId)) {
        await prisma.playCountRefresh.deleteMany({ where: { id: item.id } }); continue;
      }
      try {
        const count = await provider.fetchItemPlayCount!(connector, item.externalId);
        if (count == null) throw Error('Jellyfin has not supplied a native play count');
        const applied = await applyNativeCount(connector, item.externalId, count, now);
        if (!applied) continue;
        refreshed++;
        const complete = item.baselineCount != null ? count !== item.baselineCount || item.attempts >= 4 : item.lastCount != null;
        if (complete) await prisma.playCountRefresh.deleteMany({ where: { id: item.id } });
        else await prisma.playCountRefresh.updateMany({ where: { id: item.id }, data: { lastCount: count, attempts: { increment: 1 }, lastError: null,
          nextAttemptAt: new Date(now.getTime() + Math.min(120, 15 * 2 ** Math.min(item.attempts, 3)) * 1000) } });
      } catch (error) {
        if (isNotFound(error)) { await prisma.playCountRefresh.deleteMany({ where: { id: item.id } }); continue; }
        await prisma.playCountRefresh.updateMany({ where: { id: item.id }, data: { attempts: { increment: 1 }, lastError: redactMessage(error),
          nextAttemptAt: new Date(now.getTime() + Math.min(900, 15 * 2 ** Math.min(item.attempts, 6)) * 1000) } });
        await logActivity('warn', `play-count-refresh:${connector.id}`, error);
        // One failed native read is enough to establish an outage this tick.
        break;
      }
    }
  }
  if (failures) throw Error(`${failures} Jellyfin playback source(s) unavailable; existing observations and pending item refreshes retained`);
  return `${observed} sessions observed; ${refreshed} individual video counts refreshed`;
}

async function applyNativeCount(connector: LibraryConnector, externalId: string, count: number, now: Date): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const current = await tx.libraryConnector.findUnique({ where: { id: connector.id } });
    if (!current?.enabled || current.videoSyncRunning || playbackScope(current) !== playbackScope(connector)) return false;
    const video = await tx.libraryVideo.findFirst({ where: { connectorId: connector.id, libraryId: connector.videoLibraryId, externalId, available: true },
      include: { musicVideo: { include: { file: true, artist: { include: { rootFolder: true } } } } } });
    if (video && video.playCount !== count) await tx.libraryVideo.update({ where: { id: video.id }, data: { playCount: count } });
    const file = video?.matchConfidence == null ? video?.musicVideo?.file : null;
    const target = video?.musicVideo?.artist.rootFolder.targetConnectorId;
    if (file && (target == null || target === connector.id)) {
      let fileCount = count;
      if (target == null) {
        const copies = await tx.libraryVideo.findMany({ where: { musicVideoId: video!.musicVideoId!, available: true, matchConfidence: null, connector: { enabled: true } },
          select: { playCount: true, libraryId: true, connector: { select: { videoLibraryId: true } } } });
        const counts = copies.filter(copy => copy.libraryId === copy.connector.videoLibraryId && copy.playCount != null).map(copy => copy.playCount!);
        if (counts.length) fileCount = Math.max(...counts);
      }
      await tx.musicVideoFile.update({ where: { id: file.id }, data: { playCount: fileCount, playCountSyncedAt: now } });
    }
    await tx.recordingServerCopy.updateMany({ where: { connectorId: connector.id, libraryId: connector.videoLibraryId!, externalId, available: true,
      part: { recording: { reviewStatus: 'accepted', identityVerified: true, videoVerified: true, deletionState: null } } }, data: { playCount: count } });
    return true;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function getNowPlaying(now = new Date()) {
  const task = await prisma.scheduledTask.findUnique({ where: { name: 'Playback Monitor' } });
  if (task?.enabled === false) return { enabled: false, stale: false, items: [] };
  const connectors = await prisma.libraryConnector.findMany({ where: { enabled: true, type: 'jellyfin', userId: { not: null }, videoLibraryId: { not: null } } });
  const items = [];
  for (const connector of connectors) {
    const sessions = await prisma.playbackObservation.findMany({ where: { connectorId: connector.id, scope: playbackScope(connector) }, orderBy: { id: 'asc' } });
    const copies = await eligibleCopies(connector, sessions.map(session => session.externalId));
    for (const session of sessions) {
      const video = copies.videos.get(session.externalId);
      const canonical = video?.matchConfidence == null && video?.musicVideoId ? await prisma.musicVideo.findUnique({ where: { id: video.musicVideoId }, select: { id: true, title: true, artistId: true, catalogKind: true, artist: { select: { name: true } } } }) : null;
      const live = copies.live.get(session.externalId);
      if (!video && !live) continue;
      items.push({ id: session.id, connectorName: connector.name, title: canonical?.title ?? session.title, artistName: canonical?.artist.name ?? session.artistName,
        userName: session.userName, deviceName: session.deviceName, playing: session.playing, lastSeenAt: session.lastSeenAt.toISOString(),
        musicVideoId: canonical?.id ?? null, artistId: canonical?.artistId ?? null, catalogKind: canonical?.catalogKind ?? null,
        recordingId: live?.part.recordingId ?? null });
    }
  }
  return { enabled: true, stale: task?.lastResult === 'failed' || !task?.lastRunAt || now.getTime() - task.lastRunAt.getTime() > 45_000
    || items.some(item => now.getTime() - new Date(item.lastSeenAt).getTime() > 45_000), items };
}

import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider, type LibraryPlaybackSession } from '../providers/library/index.js';
import { observedPlaybackSeconds, qualifiedPlayThreshold } from './playbackObservation.js';
import { baseUrl } from '../providers/library/util.js';

let operation: Promise<string> | null = null;
export async function resetQualifiedPlaybackContinuity(): Promise<void> {
  await prisma.qualifiedPlayback.updateMany({ where: { active: true }, data: { playing: false } });
}
export function pollQualifiedPlayback(now = new Date()): Promise<string> {
  if (operation) return operation;
  operation = poll(now).finally(() => { operation = null; });
  return operation;
}

async function poll(now: Date): Promise<string> {
  const connectors = await prisma.libraryConnector.findMany({ where: { enabled: true, videoLibraryId: { not: null }, type: { in: ['jellyfin', 'plex'] } }, orderBy: { id: 'asc' } });
  // Different connector credentials can expose overlapping sessions. Merge
  // observations for the same server/library/session before crediting time.
  const sources = new Map<string, { failed: boolean; success: boolean; sessions: Map<string, { connectorIds: number[]; session: LibraryPlaybackSession }> }>();
  let failures = 0;
  for (const connector of connectors) {
    let key: string;
    try {
      const url = new URL(baseUrl(connector.host));
      key = JSON.stringify([connector.type, url.origin + url.pathname.replace(/\/+$/, ''), connector.videoLibraryId]);
    } catch (error) { failures++; await logActivity('warn', 'qualified-playback', error); continue; }
    const source = sources.get(key) ?? { failed: false, success: false, sessions: new Map() };
    sources.set(key, source);
    try {
      const provider = getLibraryConnectorProvider(connector.type);
      if (!provider.fetchPlaybackSessions) throw new Error('Connector does not support playback observation.');
      for (const session of await provider.fetchPlaybackSessions(connector)) {
        if (!session.sessionId || !session.externalId || !Number.isFinite(session.positionSeconds) || session.positionSeconds < 0
          || !Number.isFinite(session.durationSeconds) || session.durationSeconds <= 0 || session.positionSeconds > session.durationSeconds + 3) continue;
        const identity = JSON.stringify([session.sessionId, session.userId ?? '']);
        const existing = source.sessions.get(identity);
        if (existing) existing.connectorIds.push(connector.id);
        else source.sessions.set(identity, { connectorIds: [connector.id], session });
      }
      source.success = true;
    } catch (error) {
      failures++;
      source.failed = true;
      await logActivity('warn', 'qualified-playback', error);
    }
  }
  let qualified = 0;
  let observed = 0;
  const sourceKeys = [...sources.keys()];
  await prisma.qualifiedPlayback.updateMany({ where: { active: true, sourceKey: { notIn: sourceKeys } }, data: { active: false, playing: false } });
  for (const [sourceKey, source] of sources) {
    if (source.failed) await prisma.qualifiedPlayback.updateMany({ where: { sourceKey, active: true }, data: { playing: false } });
    const seen: number[] = [];
    for (const [sessionId, { connectorIds, session }] of source.sessions) {
      const matches = await prisma.libraryVideo.findMany({ where: { connectorId: { in: connectorIds }, externalId: session.externalId, available: true, matchConfidence: null }, include: { musicVideo: true, connector: { select: { videoLibraryId: true } } }, orderBy: { id: 'asc' } });
      if (new Set(matches.filter(item => item.musicVideoId != null).map(item => item.musicVideoId)).size > 1) continue;
      const libraryVideo = matches.find(item => item.musicVideo != null);
      if (!libraryVideo?.available || libraryVideo.matchConfidence != null || !libraryVideo.musicVideo || libraryVideo.musicVideo.deletionState) continue;
      const connectorId = libraryVideo.connectorId;
      let play = await prisma.qualifiedPlayback.findFirst({ where: { sourceKey, sessionId, active: true }, orderBy: { id: 'desc' } });
      const restarted = play && play.externalId === session.externalId && play.positionSeconds >= Math.max(play.durationSeconds - 15, play.durationSeconds * 0.9)
        && session.positionSeconds < Math.min(15, play.durationSeconds * 0.1);
      if (play && (play.externalId !== session.externalId || play.musicVideoId !== libraryVideo.musicVideoId || restarted)) {
        await prisma.qualifiedPlayback.update({ where: { id: play.id }, data: { active: false, playing: false } });
        play = null;
      }
      if (!play) {
        play = await prisma.qualifiedPlayback.create({ data: { sourceKey, connectorId, libraryId: libraryVideo.connector.videoLibraryId!, sessionId,
          externalId: session.externalId, userId: session.userId, musicVideoId: libraryVideo.musicVideo.id,
          durationSeconds: session.durationSeconds, positionSeconds: session.positionSeconds, playing: session.playing, lastObservedAt: now, firstObservedAt: now } });
      } else if (now > play.lastObservedAt) {
        const listenedSeconds = play.listenedSeconds + observedPlaybackSeconds(play, session, now);
        await prisma.$transaction(async tx => {
          await tx.qualifiedPlayback.update({ where: { id: play!.id }, data: { connectorId, lastObservedAt: now, positionSeconds: session.positionSeconds, playing: session.playing, listenedSeconds } });
          if (listenedSeconds >= qualifiedPlayThreshold(play!.durationSeconds)) {
            const claimed = await tx.qualifiedPlayback.updateMany({ where: { id: play!.id, qualifiedAt: null }, data: { qualifiedAt: now } });
            if (claimed.count) { await tx.musicVideo.update({ where: { id: play!.musicVideoId }, data: { qualifiedPlayCount: { increment: 1 }, lastQualifiedPlayAt: now } }); qualified++; }
          }
        });
      }
      seen.push(play.id); observed++;
    }
    // A failed server read cannot prove a session ended. Preserve its identity
    // and earned time, but never credit the unobserved gap on reconnect.
    if (source.success && !source.failed) await prisma.qualifiedPlayback.updateMany({ where: { sourceKey, active: true, id: { notIn: seen } }, data: { active: false, playing: false } });
  }
  // Counters outlive bounded session diagnostics; native server counts stay intact.
  await prisma.qualifiedPlayback.deleteMany({ where: { active: false, lastObservedAt: { lt: new Date(now.getTime() - 30 * 86400_000) } } });
  return `${observed} session(s) observed, ${qualified} qualified play(s) recorded, ${failures} source(s) incomplete`;
}

let wakePending = false;
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let lastWakeAt = 0;
export function wakeQualifiedPlayback(): void {
  if (wakePending) return;
  wakePending = true;
  wakeTimer = setTimeout(() => {
    wakePending = false;
    lastWakeAt = Date.now();
    void pollQualifiedPlayback().catch(error => logActivity('warn', 'qualified-playback', error).catch(() => {}));
  }, Math.max(500, 5_000 - (Date.now() - lastWakeAt)));
  wakeTimer.unref();
}

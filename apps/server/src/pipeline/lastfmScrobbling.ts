import type { LastFmPlayback } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider, type LibraryPlaybackSession } from '../providers/library/index.js';
import { LastFmError, lastFmCall } from '../providers/lastfmClient.js';

// Account changes and polling share one lock so an in-flight request cannot
// submit old queued playback to a newly linked account. Scheduler overlap is
// also serialized. Vidarr runs one server process per configuration database.
let lastOperation: Promise<unknown> = Promise.resolve();
export function withLastFmLock<T>(work: () => Promise<T>): Promise<T> {
  const result = lastOperation.then(work, work);
  lastOperation = result.catch(() => {});
  return result;
}

export async function resetLastFmAccount(): Promise<void> {
  await prisma.$transaction([
    prisma.lastFmPlayback.deleteMany(),
    prisma.lastFmAccount.deleteMany(),
  ]);
}

export function observedPlaybackSeconds(previous: LastFmPlayback, current: LibraryPlaybackSession, now: Date): number {
  const elapsed = (now.getTime() - previous.lastObservedAt.getTime()) / 1000;
  const progress = current.positionSeconds - previous.positionSeconds;
  // A seek never earns its skipped seconds. Discontinuous jumps and long
  // outages earn nothing; paused/buffering endpoints are conservative too.
  if (!previous.playing || !current.playing || elapsed <= 0 || elapsed > 45
    || progress <= 0 || progress > elapsed + 3) return 0;
  return Math.min(elapsed, progress);
}

function usableMetadata(value: string | undefined): value is string {
  return !!value?.trim() && !/^(unknown(?: artist)?|various artists|untitled)$/i.test(value.trim());
}

async function noteError(error: unknown): Promise<boolean> {
  const message = error instanceof LastFmError ? error.message : 'Could not read media-server playback. Check connector access and availability.';
  const expired = error instanceof LastFmError && [4, 9, 10, 13, 26].includes(error.code ?? 0);
  await prisma.lastFmAccount.update({ where: { id: 1 }, data: {
    lastError: message, ...(expired ? { scrobblingEnabled: false } : {}),
    ...(error instanceof LastFmError && error.code === 9 ? { sessionKey: null } : {}),
  } });
  return expired;
}

export function pollLastFmPlayback(now = new Date()): Promise<string> {
  return withLastFmLock(async () => {
    const account = await prisma.lastFmAccount.findUnique({ where: { id: 1 } });
    if (!account?.scrobblingEnabled || !account.sessionKey) return 'Last.fm scrobbling is disabled';
    const config = await prisma.recommendationProviderConfig.findUnique({ where: { provider: 'lastfm' } });
    if (!config?.apiKey || !config.clientSecret) return 'Last.fm credentials are missing';
    const connectors = await prisma.libraryConnector.findMany({ where: {
      enabled: true, videoLibraryId: { not: null }, type: { in: ['plex', 'jellyfin'] },
    } });
    let observed = 0;
    let sent = 0;
    let skipped = 0;
    let hadError = false;
    // Discard pending delivery for removed/disabled sources. Never send stale
    // queued items after their connector or selected library has changed.
    const enabledSources = new Set(connectors.map((c) => `${c.id}:${c.videoLibraryId}`));
    const stored = await prisma.lastFmPlayback.findMany({ select: { id: true, connectorId: true, libraryId: true } });
    const removed = stored.filter((p) => !enabledSources.has(`${p.connectorId}:${p.libraryId}`)).map((p) => p.id);
    if (removed.length) await prisma.lastFmPlayback.deleteMany({ where: { id: { in: removed } } });

    for (const connector of connectors) {
      let sessions: LibraryPlaybackSession[];
      try {
        sessions = await getLibraryConnectorProvider(connector.type).fetchPlaybackSessions!(connector);
      } catch (error) {
        hadError = true;
        await noteError(error);
        // A failed poll cannot establish continuous listening across a gap.
        await prisma.lastFmPlayback.updateMany({ where: { connectorId: connector.id, active: true }, data: { playing: false } });
        continue;
      }
      // Use the same poll timestamp for every session in this snapshot.
      const sampledAt = now;
      const seen: number[] = [];
      for (const session of sessions) {
        if (!Number.isFinite(session.positionSeconds) || session.positionSeconds < 0
          || !Number.isFinite(session.durationSeconds) || session.durationSeconds <= 30) { skipped++; continue; }
        let play = await prisma.lastFmPlayback.findFirst({ where: {
          connectorId: connector.id, sessionId: session.sessionId, active: true,
        }, orderBy: { id: 'desc' } });
        // A new item, a completed track restarting near zero, or a session
        // returning after disappearing is a new play, never a duplicate queue.
        const restarted = play && play.externalId === session.externalId
          && play.positionSeconds >= play.durationSeconds - 15 && session.positionSeconds < 15;
        if (play && (play.externalId !== session.externalId || restarted)) {
          await prisma.lastFmPlayback.update({ where: { id: play.id }, data: { active: false } });
          play = null;
        }
        if (!play) {
          const video = await prisma.libraryVideo.findUnique({
            where: { connectorId_externalId: { connectorId: connector.id, externalId: session.externalId } },
            include: { musicVideo: { include: { artist: true } } },
          });
          // Fuzzy suggestions are not identities. Use a confirmed match or
          // structured server artist/title fields; never infer from filenames.
          const matched = video?.available && !video.matchConfidence ? video.musicVideo : null;
          const artist = matched?.artist.name ?? session.artistName;
          const track = matched?.title ?? session.title;
          if (!usableMetadata(artist) || !usableMetadata(track)) { skipped++; continue; }
          play = await prisma.lastFmPlayback.create({ data: {
            connectorId: connector.id, libraryId: connector.videoLibraryId!, sessionId: session.sessionId,
            externalId: session.externalId, artist: artist.trim(), track: track.trim(),
            durationSeconds: session.durationSeconds,
            // Approximate the original start for a mid-play join, but do not
            // credit any listening that happened before observation.
            startedAt: Math.floor(sampledAt.getTime() / 1000 - Math.min(session.positionSeconds, session.durationSeconds)),
            lastObservedAt: sampledAt, positionSeconds: session.positionSeconds, playing: session.playing,
          } });
        } else {
          const listenedSeconds = play.listenedSeconds + observedPlaybackSeconds(play, session, sampledAt);
          play = await prisma.lastFmPlayback.update({ where: { id: play.id }, data: {
            listenedSeconds, lastObservedAt: sampledAt, positionSeconds: session.positionSeconds, playing: session.playing,
            ...(!play.status && listenedSeconds >= Math.min(play.durationSeconds / 2, 240) ? { status: 'pending', nextAttemptAt: sampledAt } : {}),
          } });
        }
        seen.push(play.id);
        observed++;
        if (play.playing && !play.nowPlayingSent) {
          try {
            const result = await lastFmCall(config.apiKey, config.clientSecret, 'track.updateNowPlaying', {
              sk: account.sessionKey, artist: play.artist, track: play.track, duration: String(Math.round(play.durationSeconds)),
            });
            if (!result.nowplaying) throw new LastFmError(null, true, 'Last.fm returned an invalid now-playing response.');
            await prisma.lastFmPlayback.update({ where: { id: play.id }, data: { nowPlayingSent: true } });
          } catch (error) {
            hadError = true;
            if (await noteError(error)) return 'Last.fm needs authorization or corrected credentials';
            // Now-playing is ephemeral: do not retry a permanent failure.
            if (error instanceof LastFmError && !error.retryable) {
              await prisma.lastFmPlayback.update({ where: { id: play.id }, data: { nowPlayingSent: true } });
            }
          }
        }
      }
      await prisma.lastFmPlayback.updateMany({ where: {
        connectorId: connector.id, active: true, ...(seen.length ? { id: { notIn: seen } } : {}),
      }, data: { active: false, playing: false } });
    }
    // Oldest pending first, bounded work per tick, backoff persisted across
    // restarts. Stop on a transient failure so newer plays cannot overtake it.
    const pending = await prisma.lastFmPlayback.findMany({ where: { status: 'pending' }, orderBy: [
      { startedAt: 'asc' }, { id: 'asc' },
    ], take: 50 });
    for (const play of pending) {
      if (play.nextAttemptAt && play.nextAttemptAt > now) break;
      try {
        const result = await lastFmCall(config.apiKey, config.clientSecret, 'track.scrobble', {
          sk: account.sessionKey, artist: play.artist, track: play.track,
          duration: String(Math.round(play.durationSeconds)), timestamp: String(play.startedAt),
        });
        const accepted = Number(result.scrobbles?.['@attr']?.accepted);
        const ignored = Number(result.scrobbles?.['@attr']?.ignored);
        if (accepted !== 1 && ignored !== 1) throw new LastFmError(null, true, 'Last.fm returned an invalid scrobble response.');
        await prisma.lastFmPlayback.update({ where: { id: play.id }, data: {
          status: accepted === 1 ? 'sent' : 'ignored', attempts: { increment: 1 }, nextAttemptAt: null,
          lastError: accepted === 1 ? null : `Last.fm ignored this play (code ${Number(result.scrobbles?.scrobble?.ignoredMessage?.code) || 'unknown'}).`,
        } });
        if (accepted === 1) {
          sent++;
          await prisma.lastFmAccount.update({ where: { id: 1 }, data: { lastScrobbledAt: now } });
        }
      } catch (error) {
        hadError = true;
        if (await noteError(error)) return 'Last.fm needs authorization or corrected credentials';
        const retry = !(error instanceof LastFmError) || error.retryable;
        await prisma.lastFmPlayback.update({ where: { id: play.id }, data: {
          attempts: { increment: 1 }, status: retry ? 'pending' : 'failed',
          nextAttemptAt: retry ? new Date(now.getTime() + Math.min(3600, 30 * 2 ** Math.min(play.attempts, 7)) * 1000) : null,
          lastError: error instanceof LastFmError ? error.message : 'Could not submit this play to Last.fm.',
        } });
        if (retry) break;
      }
    }
    // Keep up to 30 days of diagnostics; pending delivery is retained until
    // submitted/ignored or explicitly disabled/unlinked by the owner.
    await prisma.lastFmPlayback.deleteMany({ where: {
      active: false, OR: [{ status: null }, { status: { not: 'pending' } }], lastObservedAt: { lt: new Date(now.getTime() - 30 * 86400_000) },
    } });
    await prisma.lastFmAccount.update({ where: { id: 1 }, data: { lastPollAt: now, ...(!hadError ? { lastError: null } : {}) } });
    return `${observed} play(s) observed, ${sent} scrobbled, ${skipped} skipped (duration or metadata)`;
  });
}

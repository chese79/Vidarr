import type { LibraryPlaybackSession } from '../providers/library/types.js';

export function observedPlaybackSeconds(previous: { lastObservedAt: Date; positionSeconds: number; playing: boolean }, current: LibraryPlaybackSession, now: Date): number {
  const elapsed = (now.getTime() - previous.lastObservedAt.getTime()) / 1000;
  const progress = current.positionSeconds - previous.positionSeconds;
  // Only observed continuous progress earns time. Pauses, buffering, seeks,
  // duplicate snapshots and outages cannot stand in for watched seconds.
  if (!previous.playing || !current.playing || elapsed <= 0 || elapsed > 45 || progress <= 0 || progress > elapsed + 3) return 0;
  return Math.min(elapsed, progress);
}

export const qualifiedPlayThreshold = (durationSeconds: number): number => Math.min(durationSeconds / 2, 240);

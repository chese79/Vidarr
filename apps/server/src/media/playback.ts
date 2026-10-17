export interface PlaybackPosition {
  positionSeconds: number;
  playing: boolean;
}

export function observedPlaybackSeconds(previous: PlaybackPosition & { lastObservedAt: Date }, current: PlaybackPosition, now: Date): number {
  const elapsed = (now.getTime() - previous.lastObservedAt.getTime()) / 1000;
  const progress = current.positionSeconds - previous.positionSeconds;
  // Pauses, buffering, seeks, duplicate snapshots and outages earn no time.
  if (!previous.playing || !current.playing || elapsed <= 0 || elapsed > 45 || progress <= 0 || progress > elapsed + 3) return 0;
  return Math.min(elapsed, progress);
}

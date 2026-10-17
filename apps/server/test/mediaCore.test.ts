import { describe, expect, it } from 'vitest';
import { ACTIVE_DOWNLOAD_STATUSES, deriveMediaLifecycle } from '../src/media/lifecycle.js';
import { observedPlaybackSeconds } from '../src/media/playback.js';
import { observedPlaybackSeconds as legacyObservation, qualifiedPlayThreshold } from '../src/pipeline/playbackObservation.js';
import { assertVideoMedia, NotAVideoError } from '../src/media/inspection.js';
import { assertIsRealMusicVideo, NotAVideoError as LegacyError } from '../src/pipeline/validateVideoFile.js';
import { withValidationWorker } from '../src/media/validationWorker.js';
import { withValidationWorker as legacyWorker } from '../src/pipeline/validationWorker.js';
import { computeVideoStatus } from '../src/pipeline/videoStatus.js';
import { preferredDirectSource, validationCategoryForSource } from '../src/catalog/musicVideoPolicy.js';

describe('shared media foundations', () => {
  it('retains identical inspector, worker and observation compatibility entry points', () => {
    expect(assertIsRealMusicVideo).toBe(assertVideoMedia);
    expect(LegacyError).toBe(NotAVideoError);
    expect(legacyWorker).toBe(withValidationWorker);
    expect(legacyObservation).toBe(observedPlaybackSeconds);
  });

  it('serializes legacy and shared inspections and releases the worker on failure', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = legacyWorker(async () => { events.push('first'); await gate; throw new Error('probe failed'); });
    const rejected = expect(first).rejects.toThrow('probe failed');
    const second = withValidationWorker(async () => { events.push('second'); return 7; });
    await Promise.resolve();
    expect(events).toEqual(['first']);
    release();
    await rejected;
    expect(await second).toBe(7);
    expect(events).toEqual(['first', 'second']);
  });

  it('requires both availability and confirmation for server ownership', () => {
    const facts = { localAvailable: false, queueItems: [], awaitingDelivery: false };
    expect(deriveMediaLifecycle({ ...facts, serverCopies: [{ available: true, confirmed: false }, { available: false, confirmed: true }] }).ownership).toBe('none');
    expect(deriveMediaLifecycle({ ...facts, serverCopies: [{ available: true, confirmed: true }] }).ownership).toBe('server');
  });

  it.each(ACTIVE_DOWNLOAD_STATUSES)('preserves %s reservations ahead of delivery and historical failure', status => {
    const result = computeVideoStatus({ hasFile: false, monitored: true, artistMonitored: true, ignored: false,
      libraryVideos: [], queueItems: [{ status: 'failed' }, { status, progress: 0.25 }], awaitingServerScanAt: new Date() });
    expect(result).toEqual({ ownership: 'none', acquisition: status, progress: 0.25, eligibleForAutoSearch: false });
  });

  it('keeps failed history eligible, pending delivery ineligible, and owned failures cleared', () => {
    const input = { hasFile: false, monitored: true, artistMonitored: true, ignored: false, libraryVideos: [], queueItems: [{ status: 'failed' }] };
    expect(computeVideoStatus(input)).toMatchObject({ acquisition: 'failed', eligibleForAutoSearch: true });
    expect(computeVideoStatus({ ...input, awaitingServerScanAt: new Date() })).toMatchObject({ acquisition: 'awaitingServerScan', eligibleForAutoSearch: false });
    expect(computeVideoStatus({ ...input, hasFile: true })).toMatchObject({ acquisition: null, eligibleForAutoSearch: false });
  });

  it('retains music-video trust and authority preference without changing source order', () => {
    expect(validationCategoryForSource({ accepted: true, authority: 'verified', confidence: 'confirmed' })).toBe('canonical');
    expect(validationCategoryForSource({ accepted: true, authority: 'verified', confidence: 'probable' })).toBe('additional');
    const sources = [{ id: 1, authority: 'manual', url: 'https://manual' }, { id: 2, authority: 'authoritative', url: 'https://official' }];
    expect(preferredDirectSource(sources)?.id).toBe(2);
    expect(sources[0].id).toBe(1);
    expect(qualifiedPlayThreshold(900)).toBe(240);
    expect(qualifiedPlayThreshold(100)).toBe(50);
  });

  it.each([
    [10, 10, true, 10], [10, 0, true, 0], [10, 50, true, 0],
    [46, 46, true, 0], [10, 10, false, 0], [10, 12, true, 10],
  ])('credits only observed progress: elapsed %s, progress %s, playing %s', (elapsed, progress, playing, expected) => {
    expect(observedPlaybackSeconds({ lastObservedAt: new Date(0), positionSeconds: 20, playing: true },
      { positionSeconds: 20 + progress, playing }, new Date(elapsed * 1000))).toBe(expected);
  });
});

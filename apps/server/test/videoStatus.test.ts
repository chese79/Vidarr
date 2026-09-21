import { describe, it, expect } from 'vitest';
import { computeVideoStatus, type VideoStatusInput } from '../src/pipeline/videoStatus.js';

function baseInput(overrides: Partial<VideoStatusInput> = {}): VideoStatusInput {
  return {
    hasFile: false,
    monitored: true,
    ignored: false,
    artistMonitored: true,
    libraryVideos: [],
    queueItems: [],
    ...overrides,
  };
}

describe('computeVideoStatus', () => {
  it('ownership: none when there is no file and no available library match', () => {
    expect(computeVideoStatus(baseInput()).ownership).toBe('none');
  });

  it('ownership: local when there is a file and no library match', () => {
    expect(computeVideoStatus(baseInput({ hasFile: true })).ownership).toBe('local');
  });

  it('ownership: server when there is an available library match but no file', () => {
    const status = computeVideoStatus(baseInput({ libraryVideos: [{ available: true }] }));
    expect(status.ownership).toBe('server');
  });

  it('ownership: both when there is a file and an available library match', () => {
    const status = computeVideoStatus(
      baseInput({ hasFile: true, libraryVideos: [{ available: true }] }),
    );
    expect(status.ownership).toBe('both');
  });

  it('a library match that is not available does not count toward ownership', () => {
    const status = computeVideoStatus(baseInput({ libraryVideos: [{ available: false }] }));
    expect(status.ownership).toBe('none');
  });

  it('acquisition: downloading when an active queue item exists', () => {
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'downloading' }] }));
    expect(status.acquisition).toBe('downloading');
  });

  it('acquisition: failed when the only queue item failed', () => {
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'failed' }] }));
    expect(status.acquisition).toBe('failed');
  });

  it('acquisition: downloading takes priority over a stale failed entry', () => {
    const status = computeVideoStatus(
      baseInput({ queueItems: [{ status: 'failed' }, { status: 'downloading' }] }),
    );
    expect(status.acquisition).toBe('downloading');
  });

  it('acquisition: null when there is no queue item at all', () => {
    expect(computeVideoStatus(baseInput()).acquisition).toBeNull();
  });

  it('eligibleForAutoSearch: true for a plain missing, monitored video owned by a monitored artist', () => {
    expect(computeVideoStatus(baseInput()).eligibleForAutoSearch).toBe(true);
  });

  it('eligibleForAutoSearch: false when the artist itself is unmonitored, even if the video is monitored', () => {
    // This is the specific gap the request doc called out: today's backlog
    // search only checked the video's own `monitored` flag.
    const status = computeVideoStatus(baseInput({ artistMonitored: false }));
    expect(status.eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: false when the video itself is unmonitored', () => {
    expect(computeVideoStatus(baseInput({ monitored: false })).eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: false when the video is ignored', () => {
    expect(computeVideoStatus(baseInput({ ignored: true })).eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: false when already available on the server', () => {
    const status = computeVideoStatus(baseInput({ libraryVideos: [{ available: true }] }));
    expect(status.eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: false when a download is already active', () => {
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'downloading' }] }));
    expect(status.eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: true again once a prior failed attempt is the only queue history', () => {
    // A failed attempt shouldn't permanently block future auto-search the
    // way an active download does.
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'failed' }] }));
    expect(status.eligibleForAutoSearch).toBe(true);
  });
});

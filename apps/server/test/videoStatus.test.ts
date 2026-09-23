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

  it('ownership: server when there is an available, confirmed library match but no file', () => {
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: true, matchConfidence: null }] }),
    );
    expect(status.ownership).toBe('server');
  });

  it('ownership: both when there is a file and an available, confirmed library match', () => {
    const status = computeVideoStatus(
      baseInput({ hasFile: true, libraryVideos: [{ available: true, matchConfidence: null }] }),
    );
    expect(status.ownership).toBe('both');
  });

  it('a library match that is not available does not count toward ownership', () => {
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: false, matchConfidence: null }] }),
    );
    expect(status.ownership).toBe('none');
  });

  it('ownership: none for an unconfirmed probable fuzzy match — it is a suggestion, not owned', () => {
    // The bug this guards: reconciliation.ts's fuzzy fallback (Phase 2b) can
    // propose a wrong match. Until a human confirms it (which clears
    // matchConfidence to null via the review UI), it must not count as
    // ownership or it would silently mark a genuinely missing video as
    // present and suppress it from auto-search.
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: true, matchConfidence: 'probable' }] }),
    );
    expect(status.ownership).toBe('none');
  });

  it('ownership: none for an unconfirmed ambiguous fuzzy match, same as probable', () => {
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: true, matchConfidence: 'ambiguous' }] }),
    );
    expect(status.ownership).toBe('none');
  });

  it('ownership: server once a probable match is confirmed (matchConfidence cleared to null)', () => {
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: true, matchConfidence: null }] }),
    );
    expect(status.ownership).toBe('server');
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

  it('eligibleForAutoSearch: false when already available on the server (confirmed match)', () => {
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: true, matchConfidence: null }] }),
    );
    expect(status.eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: true when the only library match is an unconfirmed probable suggestion', () => {
    const status = computeVideoStatus(
      baseInput({ libraryVideos: [{ available: true, matchConfidence: 'probable' }] }),
    );
    expect(status.eligibleForAutoSearch).toBe(true);
  });

  it('eligibleForAutoSearch: false when a download is already active', () => {
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'downloading' }] }));
    expect(status.eligibleForAutoSearch).toBe(false);
  });

  it('treats an uncertain remote submission as active and ineligible for automatic retry', () => {
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'submissionUnknown' }] }));
    expect(status.acquisition).toBe('downloading');
    expect(status.eligibleForAutoSearch).toBe(false);
  });

  it('eligibleForAutoSearch: true again once a prior failed attempt is the only queue history', () => {
    // A failed attempt shouldn't permanently block future auto-search the
    // way an active download does.
    const status = computeVideoStatus(baseInput({ queueItems: [{ status: 'failed' }] }));
    expect(status.eligibleForAutoSearch).toBe(true);
  });
});

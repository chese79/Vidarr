import { expect, it } from 'vitest';
import { withoutRetiredPlayCounters } from '../src/media/serverPlayCounts.js';
import { effectivePlayCount } from '../src/pipeline/videoStatus.js';
import { JOBS } from '../src/scheduler/jobs.js';

it('publishes server counts and unknown values without retired counters at any nested level', () => {
  const date = new Date('2026-10-18T00:00:00Z');
  const old = { qualifiedPlayCount: 100, lastQualifiedPlayAt: date, items: [{ qualifiedAt: date, playCount: 0 }, { playCount: null }], date };
  expect(withoutRetiredPlayCounters(old)).toEqual({ items: [{ playCount: 0 }, { playCount: null }], date });
  expect(old.qualifiedPlayCount).toBe(100);
  expect(effectivePlayCount(null, [])).toBeNull();
  expect(effectivePlayCount(null, [{ available: true, matchConfidence: null, playCount: 0 }])).toBe(0);
  expect(effectivePlayCount(null, [{ available: false, matchConfidence: null, playCount: 10 }])).toBeNull();
});

it('does not schedule qualification and retains independent resume observation', () => {
  expect(JOBS.some(job => /qualified/i.test(job.name))).toBe(false);
  expect(JOBS.some(job => job.name === 'Live Playback Resume')).toBe(true);
});

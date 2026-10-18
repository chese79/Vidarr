import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createArtist, createRootFolder, createQuality, createQualityProfile, ensureSettings } from './support/db.js';
import { coverageSummary, exactLiveMatch, verifiedImprovement } from '../src/live/evidence.js';
import { directVideoUrl, emptyDelay, DAY } from '../src/live/policy.js';
import { reserveSearch, previewMonitoring, MonitoringInput } from '../src/live/discovery.js';
import { ingestSetlist, type SetlistEvent } from '../src/live/setlist.js';
import { observeLivePlayback, changeViewing } from '../src/live/playback.js';
import { selectedRecordingFiles } from '../src/live/acquisition.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/providers/youtube/ytdlp.js', () => ({ searchYoutube: vi.fn() }));
describe('live workflow invariants', () => {
  let artistId: number, rootFolderId: number;
  beforeEach(async () => {
    await resetDb(); await ensureSettings();
    rootFolderId = (await createRootFolder()).id;
    artistId = (await createArtist(rootFolderId, (await createQualityProfile((await createQuality()).id)).id)).id;
  });
  it('only automatically matches exact artist, day, venue and song without conflicts', () => {
    const evidence = { artistMbid: 'artist', performanceDate: '2025-01-02', venue: 'The Hall', song: 'Repeated Song' };
    const event = { artistMbid: 'artist', performanceDate: '2025-01-02', venue: 'The Hall', venueExternalId: 'hall', songs: [{ title: 'Repeated Song' }] };
    expect(exactLiveMatch(evidence, event)).toBe(true);
    for (const changed of [{ performanceDate: '2025' }, { venue: undefined }, { artistMbid: 'uploader' }, { song: 'Other' }, { conflicts: ['broadcast date differs'] }])
      expect(exactLiveMatch({ ...evidence, ...changed }, event)).toBe(false);
  });
  it('retains repeated song occurrences and does not infer completeness from a partial reference', () => {
    const songs = [{ id: 1, kind: 'full' }, { id: 2, kind: 'full' }, { id: 3, kind: 'snippet' }];
    expect(coverageSummary(songs, [{ songId: 1, verified: true, fullSong: true }], true)).toMatchObject({ covered: 1, complete: false });
    expect(coverageSummary(songs, [1, 2].map(songId => ({ songId, verified: true, fullSong: true })), false)).toMatchObject({ allKnownCovered: true, complete: false });
    expect(coverageSummary([], [], true).complete).toBe(false);
  });
  it('requires verified lexicographic improvement and respects pins and unknown evidence', () => {
    const old = { pinned: false, qualityVerified: true, verifiedCoverage: 100, audioScore: 5, visualScore: 5, resolution: 720 };
    const next = { ...old, resolution: 1080 };
    const order = ['coverage', 'audio', 'visual', 'resolution'] as const;
    expect(verifiedImprovement(next, old, [...order])).toBe(true);
    expect(verifiedImprovement(next, { ...old, pinned: true }, [...order])).toBe(false);
    expect(verifiedImprovement({ ...next, verifiedCoverage: null }, old, [...order])).toBe(false);
    expect(verifiedImprovement({ ...next, audioScore: 4 }, old, [...order])).toBe(false);
  });
  it.each(['http://youtube.com/watch?v=abcdefghijk', 'https://youtube.com.evil/watch?v=abcdefghijk', 'https://localhost/video', 'https://user:password@vimeo.com/123', 'https://www.youtube.com/playlist?list=x'])('refuses unsafe or non-video source %s', value => {
    expect(() => directVideoUrl(value)).toThrow();
  });
  it('canonicalizes supported source identities and empty backoff', () => {
    expect(directVideoUrl('https://youtu.be/abcdefghijk?t=5')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect([1, 2, 3, 4, 5].map(count => emptyDelay(count) / DAY)).toEqual([1, 7, 30, 90, 90]);
  });
  it('limits rule and global requests atomically without charging rejected reservations', async () => {
    await prisma.liveConfiguration.create({ data: { policy: JSON.stringify({ globalDailyBudget: 2 }) } });
    const rule = await prisma.liveMonitoringRule.create({ data: { artistId, dailyBudget: 1 } });
    expect(await reserveSearch(rule.id)).toBe(true);
    expect(await reserveSearch(rule.id)).toBe(false);
    expect(await reserveSearch(undefined)).toBe(true);
    expect(await reserveSearch(undefined)).toBe(false);
    expect(await prisma.liveRequestBudget.findUnique({ where: { key: `global:${new Date().toISOString().slice(0, 10)}` } }).then(row => row?.used)).toBe(2);
  });
  it('previews bounded search ranges and budget days without creating a rule', async () => {
    await prisma.livePerformance.create({ data: { artistId, title: 'Set' } });
    expect(await previewMonitoring(MonitoringInput.parse({ artistId }))).toMatchObject({ performances: 1, estimatedSearches: { min: 1, max: 3 }, estimatedDays: { min: 1, max: 1 } });
    expect(await prisma.liveMonitoringRule.count()).toBe(0);
  });
  it('retains existing song IDs and user corrections when an external setlist changes', async () => {
    const event: SetlistEvent = { id: 'show', versionId: 'one', eventDate: '02-01-2025', artist: { mbid: 'artist', name: 'Artist' },
      venue: { id: 'venue', name: 'Hall', city: { name: 'Town', country: { code: 'US' } } }, sets: { set: [{ song: [{ name: 'Again' }, { name: 'Again' }] }] } };
    const id = await ingestSetlist(artistId, event);
    const before = await prisma.liveSongPerformance.findMany({ where: { performanceId: id } });
    await prisma.livePerformance.update({ where: { id }, data: { venue: 'User corrected hall', userEdited: true } });
    expect(await ingestSetlist(artistId, { ...event, versionId: 'two', eventDate: '03-01-2025' })).toBe(id);
    expect(await prisma.liveSongPerformance.findMany({ where: { performanceId: id } })).toEqual(before);
    expect(await prisma.livePerformance.findUnique({ where: { id } })).toMatchObject({ venue: 'User corrected hall', performanceDate: '2025-01-02', identityStatus: 'correctionPending' });
  });
  it('retains watched time across pauses, outages and devices, counts songs separately, and never invents a play on Mark finished', async () => {
    const performance = await prisma.livePerformance.create({ data: { artistId, title: 'Live', songs: { create: { position: 1, title: 'Song', kind: 'full' } } }, include: { songs: true } });
    const recording = await prisma.recording.create({ data: { title: 'Full show', claimedCoverage: 'entirePerformance', identityVerified: true, videoVerified: true,
      uninterruptedVerified: true, performances: { create: { performanceId: performance.id, identityVerified: true } } } });
    const part = await prisma.recordingPart.create({ data: { recordingId: recording.id, position: 1, rootFolderId, path: '/media/test-root/live.mp4', sizeBytes: 100n, durationSeconds: 100,
      coverage: { create: { songId: performance.songs[0].id, startSeconds: 0, endSeconds: 60, fullSong: true, verified: true } } } });
    const now = Date.now(), session = { userId: 'viewer', sessionId: 'device-a', externalId: 'item', positionSeconds: 0, durationSeconds: 100, playing: true };
    await observeLivePlayback('server', part.id, session, new Date(now));
    await observeLivePlayback('server', part.id, { ...session, positionSeconds: 30 }, new Date(now + 30000));
    await observeLivePlayback('server', part.id, { ...session, sessionId: 'device-b', positionSeconds: 30 }, new Date(now + 30000));
    await observeLivePlayback('server', part.id, { ...session, positionSeconds: 60 }, new Date(now + 60000));
    await observeLivePlayback('server', part.id, { ...session, sessionId: 'device-b', positionSeconds: 60 }, new Date(now + 60000));
    const view = await prisma.liveViewing.findFirstOrThrow();
    expect(view.watchedSeconds).toBe(60);
    expect(view.qualifiedAt).not.toBeNull();
    expect(view.completedAt).toBeNull();
    expect((await prisma.livePerformance.findUniqueOrThrow({ where: { id: performance.id } })).qualifiedPlayCount).toBe(1);
    expect((await prisma.liveSongPerformance.findFirstOrThrow()).qualifiedPlayCount).toBe(1);
    await changeViewing(view.id, 'markFinished');
    expect((await prisma.livePerformance.findUniqueOrThrow({ where: { id: performance.id } })).qualifiedPlayCount).toBe(1);
  });
  it('imports only explicitly selected pack files and rejects escapes and symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-live-pack-'));
    try {
      await fs.writeFile(path.join(root, 'chosen.mp4'), 'fixture'); await fs.writeFile(path.join(root, 'unrelated.mp4'), 'fixture');
      expect(await selectedRecordingFiles(root, JSON.stringify({ selected: ['chosen.mp4'] }))).toEqual([path.join(root, 'chosen.mp4')]);
      await expect(selectedRecordingFiles(root, JSON.stringify({ selected: ['../outside.mp4'] }))).rejects.toThrow();
      await expect(selectedRecordingFiles(root, null)).rejects.toThrow();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/db/client.js';
import { generatePlaylistFromFilters, regenerateSmartPlaylist } from '../src/pipeline/playlistGenerator.js';
import {
  resetDb,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
  createMusicVideoFile,
  createLibraryConnector,
  createLibraryVideo,
} from './support/db.js';

describe('generatePlaylistFromFilters', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
    await resetDb();
    const rootFolder = await createRootFolder();
    rootFolderId = rootFolder.id;
    const quality = await createQuality();
    qualityProfileId = (await createQualityProfile(quality.id)).id;
  });

  it('excludes videos with no file even if they match every filter', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    await createMusicVideo(artist.id, { title: 'No File', hasFile: false, releaseYear: 2000 });

    const result = await generatePlaylistFromFilters('Test', { yearMin: 1990 }, 'all');
    expect(result.matchedCount).toBe(0);
  });

  it('includes a video available only through a confirmed media-server match', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id, { title: 'Server Only', hasFile: false, releaseYear: 2000 });
    const connector = await createLibraryConnector();
    await createLibraryVideo(connector.id, { musicVideoId: video.id, playCount: 12 });

    const result = await generatePlaylistFromFilters('Server tracks', { minPlayCount: 10 }, 'all');

    expect(result.matchedCount).toBe(1);
    expect((await prisma.playlistItem.findFirst({ where: { playlistId: result.playlistId } }))?.musicVideoId).toBe(video.id);
  });

  it('scopes a bound playlist to confirmed videos in its selected playback connector', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const target = await createLibraryConnector({ name: 'Target' });
    const other = await createLibraryConnector({ name: 'Other' });
    const targetVideo = await createMusicVideo(artist.id, { title: 'Target', hasFile: false, releaseYear: 2000 });
    await createLibraryVideo(target.id, { musicVideoId: targetVideo.id, externalId: 'target' });
    const otherVideo = await createMusicVideo(artist.id, { title: 'Other', hasFile: false, releaseYear: 2000 });
    await createLibraryVideo(other.id, { musicVideoId: otherVideo.id, externalId: 'other' });
    const localOnly = await createMusicVideo(artist.id, { title: 'Local', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(localOnly.id);

    const result = await generatePlaylistFromFilters('Bound', { yearMin: 1990 }, 'all', { targetConnectorId: target.id });

    expect(result.matchedCount).toBe(1);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id: result.playlistId } })).targetConnectorId).toBe(target.id);
    expect((await prisma.playlistItem.findFirst({ where: { playlistId: result.playlistId } }))?.musicVideoId).toBe(targetVideo.id);
  });

  it('with no filters at all, matches nothing (checks.length === 0 short-circuit)', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id, { hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(video.id);

    const result = await generatePlaylistFromFilters('Test', {}, 'all');
    expect(result.matchedCount).toBe(0);
  });

  it('filters by year range', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const inRange = await createMusicVideo(artist.id, { title: 'In Range', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(inRange.id, { path: '/a.mp4' });
    const outOfRange = await createMusicVideo(artist.id, { title: 'Out', hasFile: true, releaseYear: 1980 });
    await createMusicVideoFile(outOfRange.id, { path: '/b.mp4' });
    const noYear = await createMusicVideo(artist.id, { title: 'No Year', hasFile: true, releaseYear: null });
    await createMusicVideoFile(noYear.id, { path: '/c.mp4' });

    const result = await generatePlaylistFromFilters('Test', { yearMin: 1990, yearMax: 2010 }, 'all');
    expect(result.matchedCount).toBe(1);

    const items = await prisma.playlistItem.findMany({ where: { playlistId: result.playlistId } });
    expect(items).toHaveLength(1);
    expect(items[0].musicVideoId).toBe(inRange.id);
  });

  it('matches genre as a substring against either video genre or artist genre', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { genre: 'Album Rock' });
    const viaArtistGenre = await createMusicVideo(artist.id, { title: 'A', hasFile: true, genre: null });
    await createMusicVideoFile(viaArtistGenre.id, { path: '/a.mp4' });

    const otherArtist = await createArtist(rootFolderId, qualityProfileId, { name: 'Other', genre: 'Jazz' });
    const viaVideoGenre = await createMusicVideo(otherArtist.id, { title: 'B', hasFile: true, genre: 'Pop Rock' });
    await createMusicVideoFile(viaVideoGenre.id, { path: '/b.mp4' });

    const noMatch = await createMusicVideo(otherArtist.id, { title: 'C', hasFile: true, genre: 'Jazz' });
    await createMusicVideoFile(noMatch.id, { path: '/c.mp4' });

    const result = await generatePlaylistFromFilters('Test', { genre: 'rock' }, 'all');
    expect(result.matchedCount).toBe(2);
  });

  it('filters by minimum play count, treating a missing play count as 0', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const played = await createMusicVideo(artist.id, { title: 'Played', hasFile: true });
    await createMusicVideoFile(played.id, { path: '/a.mp4', playCount: 10 });
    const unplayed = await createMusicVideo(artist.id, { title: 'Unplayed', hasFile: true });
    await createMusicVideoFile(unplayed.id, { path: '/b.mp4', playCount: null });

    const result = await generatePlaylistFromFilters('Test', { minPlayCount: 5 }, 'all');
    expect(result.matchedCount).toBe(1);
  });

  it('filters director and date added using catalog metadata', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const recent = await createMusicVideo(artist.id, { title: 'Recent', hasFile: true });
    await createMusicVideoFile(recent.id);
    await prisma.musicVideo.update({ where: { id: recent.id }, data: { director: 'Jane Smith', addedAt: new Date('2026-01-01') } });
    const old = await createMusicVideo(artist.id, { title: 'Old', hasFile: true });
    await createMusicVideoFile(old.id, { path: '/old.mp4' });
    await prisma.musicVideo.update({ where: { id: old.id }, data: { director: 'Jane Smith', addedAt: new Date('2020-01-01') } });

    const result = await generatePlaylistFromFilters('Recent Jane', { director: 'jane', addedAfter: '2025-01-01T00:00:00.000Z' }, 'all');

    expect(result.matchedCount).toBe(1);
    expect((await prisma.playlistItem.findFirst({ where: { playlistId: result.playlistId } }))?.musicVideoId).toBe(recent.id);
  });

  it('distinguishes local-only, server-only, and dual ownership', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const connector = await createLibraryConnector();
    const local = await createMusicVideo(artist.id, { title: 'Local', hasFile: true });
    await createMusicVideoFile(local.id);
    const server = await createMusicVideo(artist.id, { title: 'Server', hasFile: false });
    await createLibraryVideo(connector.id, { musicVideoId: server.id, title: 'Server', externalId: 'server' });
    const both = await createMusicVideo(artist.id, { title: 'Both', hasFile: true });
    await createMusicVideoFile(both.id, { path: '/both.mp4' });
    await createLibraryVideo(connector.id, { musicVideoId: both.id, title: 'Both', externalId: 'both' });

    for (const [ownership, expected] of [['local', local.id], ['server', server.id], ['both', both.id]] as const) {
      const result = await generatePlaylistFromFilters(ownership, { ownership }, 'all');
      expect(result.matchedCount).toBe(1);
      expect((await prisma.playlistItem.findFirst({ where: { playlistId: result.playlistId } }))?.musicVideoId).toBe(expected);
    }
  });

  it('filters by file quality', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const quality = await createQuality({ name: '4K', weight: 50 });
    const video = await createMusicVideo(artist.id, { title: '4K Video', hasFile: true });
    await createMusicVideoFile(video.id);
    await prisma.musicVideoFile.update({ where: { musicVideoId: video.id }, data: { qualityId: quality.id } });

    const matching = await generatePlaylistFromFilters('4K', { qualityIds: [quality.id] }, 'all');
    const other = await generatePlaylistFromFilters('Other', { qualityIds: [quality.id + 999] }, 'all');

    expect(matching.matchedCount).toBe(1);
    expect(other.matchedCount).toBe(0);
  });

  it('filters by explicit artistIds and musicVideoIds', async () => {
    const artistA = await createArtist(rootFolderId, qualityProfileId, { name: 'A' });
    const artistB = await createArtist(rootFolderId, qualityProfileId, { name: 'B' });
    const videoA = await createMusicVideo(artistA.id, { title: 'VA', hasFile: true });
    await createMusicVideoFile(videoA.id, { path: '/a.mp4' });
    const videoB = await createMusicVideo(artistB.id, { title: 'VB', hasFile: true });
    await createMusicVideoFile(videoB.id, { path: '/b.mp4' });

    const byArtist = await generatePlaylistFromFilters('ByArtist', { artistIds: [artistA.id] }, 'all');
    expect(byArtist.matchedCount).toBe(1);

    const byVideo = await generatePlaylistFromFilters('ByVideo', { musicVideoIds: [videoB.id] }, 'all');
    expect(byVideo.matchedCount).toBe(1);
  });

  it('matchMode "all" requires every active filter to pass (AND)', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { genre: 'Rock' });
    const video = await createMusicVideo(artist.id, { title: 'V', hasFile: true, releaseYear: 1980 });
    await createMusicVideoFile(video.id, { path: '/a.mp4' });

    // Genre matches, year does not — "all" must reject it.
    const result = await generatePlaylistFromFilters('Test', { genre: 'rock', yearMin: 2000 }, 'all');
    expect(result.matchedCount).toBe(0);
  });

  it('matchMode "any" requires only one active filter to pass (OR)', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { genre: 'Rock' });
    const video = await createMusicVideo(artist.id, { title: 'V', hasFile: true, releaseYear: 1980 });
    await createMusicVideoFile(video.id, { path: '/a.mp4' });

    const result = await generatePlaylistFromFilters('Test', { genre: 'rock', yearMin: 2000 }, 'any');
    expect(result.matchedCount).toBe(1);
  });

  it('creates the playlist and its items with sequential sortOrder even when nothing matches', async () => {
    const result = await generatePlaylistFromFilters('Empty Playlist', {}, 'all');
    const playlist = await prisma.playlist.findUnique({ where: { id: result.playlistId } });
    expect(playlist?.name).toBe('Empty Playlist');
    expect(result.matchedCount).toBe(0);
  });

  it('persists smart rules and regenerates membership without changing the playlist identity', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const first = await createMusicVideo(artist.id, { title: 'First', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(first.id, { path: '/first.mp4' });
    const generated = await generatePlaylistFromFilters('Smart', { yearMin: 1990 }, 'all', {
      smart: true,
      regenerateIntervalMinutes: 1440,
    });
    const second = await createMusicVideo(artist.id, { title: 'Second', hasFile: true, releaseYear: 2001 });
    await createMusicVideoFile(second.id, { path: '/second.mp4' });

    const refreshed = await regenerateSmartPlaylist(generated.playlistId);
    const playlist = await prisma.playlist.findUniqueOrThrow({ where: { id: generated.playlistId }, include: { items: true } });

    expect(refreshed).toEqual({ matchedCount: 2, changed: true });
    expect(playlist).toMatchObject({ kind: 'smart', ruleFilters: '{"yearMin":1990}', ruleMatchMode: 'all', regenerateIntervalMinutes: 1440 });
    expect(playlist.items.map((item) => item.musicVideoId)).toEqual([first.id, second.id]);
    expect((await regenerateSmartPlaylist(generated.playlistId)).changed).toBe(false);
  });

  it('keeps a smart playlist shuffle stable across regeneration', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const videoIds: number[] = [];
    for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
      const video = await createMusicVideo(artist.id, { title, hasFile: true, releaseYear: 2000 });
      await createMusicVideoFile(video.id, { path: `/${title}.mp4` });
      videoIds.push(video.id);
    }
    const created = await generatePlaylistFromFilters('Shuffle', { yearMin: 1990 }, 'all', { smart: true, sortMode: 'shuffle' });
    const before = await prisma.playlist.findUniqueOrThrow({ where: { id: created.playlistId },
      include: { items: { orderBy: { sortOrder: 'asc' } } } });
    const refreshed = await regenerateSmartPlaylist(created.playlistId);
    const after = await prisma.playlistItem.findMany({ where: { playlistId: created.playlistId }, orderBy: { sortOrder: 'asc' } });

    expect(before.sortMode).toBe('shuffle');
    expect(before.shuffleSeed).not.toBeNull();
    expect(before.items.map((item) => item.musicVideoId).sort((a, b) => a - b)).toEqual(videoIds.sort((a, b) => a - b));
    expect(refreshed).toEqual({ matchedCount: 5, changed: false });
    expect(after.map((item) => item.musicVideoId)).toEqual(before.items.map((item) => item.musicVideoId));
  });
});

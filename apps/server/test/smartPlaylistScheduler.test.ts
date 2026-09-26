import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/client.js';
import { generatePlaylistFromFilters } from '../src/pipeline/playlistGenerator.js';
import { JOBS } from '../src/scheduler/jobs.js';
import { createArtist, createMusicVideo, createMusicVideoFile, createQuality, createQualityProfile, createRootFolder, resetDb } from './support/db.js';

describe('smart playlist scheduler', () => {
  beforeEach(resetDb);

  it('regenerates due playlists while leaving recently generated playlists alone', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    const first = await createMusicVideo(artist.id, { title: 'First', hasFile: true, releaseYear: 2000 });
    await createMusicVideoFile(first.id);
    const due = await generatePlaylistFromFilters('Due', { yearMin: 1990 }, 'all', { smart: true, regenerateIntervalMinutes: 1440 });
    const recent = await generatePlaylistFromFilters('Recent', { yearMin: 1990 }, 'all', { smart: true, regenerateIntervalMinutes: 1440 });
    await prisma.playlist.update({ where: { id: due.playlistId }, data: { lastGeneratedAt: new Date(0) } });
    const second = await createMusicVideo(artist.id, { title: 'Second', hasFile: true, releaseYear: 2001 });
    await createMusicVideoFile(second.id, { path: '/second.mp4' });

    const job = JOBS.find((entry) => entry.name === 'Smart Playlist Regeneration')!;
    await job.run();

    expect(await prisma.playlistItem.count({ where: { playlistId: due.playlistId } })).toBe(2);
    expect(await prisma.playlistItem.count({ where: { playlistId: recent.playlistId } })).toBe(1);
  });
});

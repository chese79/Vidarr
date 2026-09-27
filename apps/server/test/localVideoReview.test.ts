import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist } from './support/db.js';
import { scanLocalVideoCandidates } from '../src/pipeline/localVideoReview.js';

describe('local video scan', () => {
  let directory: string;
  beforeEach(async () => {
    await resetDb();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-local-review-'));
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('stores existing files for review without promoting them to music videos', async () => {
    const root = await createRootFolder({ path: directory });
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id, { name: 'AC/DC' });
    await prisma.artist.update({ where: { id: artist.id }, data: {
      musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    } });
    await fs.mkdir(path.join(directory, 'AC-DC'));
    await fs.writeFile(path.join(directory, 'AC-DC', 'AC-DC - Thunderstruck.mp4'), 'test video bytes');

    const result = await scanLocalVideoCandidates();

    expect(result).toMatchObject({ scanned: 1, pending: 1 });
    expect(await prisma.musicVideo.count()).toBe(0);
    expect(await prisma.videoReviewCandidate.findFirst()).toMatchObject({
      source: 'local', decision: 'pending', title: 'Thunderstruck',
    });
  });
});

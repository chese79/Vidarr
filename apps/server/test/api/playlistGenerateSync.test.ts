import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createLibraryConnector } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

const provider = vi.hoisted(() => ({ fetchVideos: vi.fn() }));
vi.mock('../../src/providers/library/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/providers/library/index.js')>()),
  getLibraryConnectorProvider: () => ({ testConnection: vi.fn(), fetchArtists: vi.fn(), fetchVideos: provider.fetchVideos, pushPlaylist: vi.fn() }),
}));

describe('POST /api/v1/playlist/generate syncs on demand', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
    provider.fetchVideos.mockReset();
  });

  it('re-reads the chosen library before matching and returns what the sync did', async () => {
    const rootFolderId = (await createRootFolder()).id;
    const qualityProfileId = (await createQualityProfile((await createQuality()).id)).id;
    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Only On Server' });
    const created = await createLibraryConnector({ name: 'JF' });
    const jf = await prisma.libraryConnector.update({ where: { id: created.id }, data: { videoLibraryId: 'lib' } });
    provider.fetchVideos.mockResolvedValue([{ externalId: 'x1', title: 'Only On Server', artistName: 'Test Artist', releaseYear: null, durationSeconds: null }]);

    const res = await app.inject({
      method: 'POST', url: '/api/v1/playlist/generate', headers: authHeaders(),
      payload: { name: 'Fresh', filters: { musicVideoIds: [video.id] }, matchMode: 'all', targetConnectorId: jf.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ matchedCount: 1, sync: [{ connectorId: jf.id, status: 'synced', videoCount: 1 }] });
  });

  it('succeeds with a failed sync reported rather than returning an error', async () => {
    const created = await createLibraryConnector({ name: 'JF' });
    const jf = await prisma.libraryConnector.update({ where: { id: created.id }, data: { videoLibraryId: 'lib' } });
    provider.fetchVideos.mockRejectedValue(new Error('server down'));

    const res = await app.inject({
      method: 'POST', url: '/api/v1/playlist/generate', headers: authHeaders(),
      payload: { name: 'Stale', filters: { genre: 'rock' }, matchMode: 'all', targetConnectorId: jf.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sync).toEqual([{ connectorId: jf.id, name: 'JF', status: 'failed', message: 'server down' }]);
  });
});

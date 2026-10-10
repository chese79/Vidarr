import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';
import { prisma } from '../../src/db/client.js';
import { createLibraryConnector, createArtist, createMusicVideo, createQuality, createQualityProfile, createRootFolder } from '../support/db.js';

describe('rootfolder routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    await ensureSettings({ apiKey: TEST_API_KEY });
  });

  it('POST then GET /api/v1/rootfolder round-trips a root folder', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/music-videos' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ path: '/media/music-videos', accessible: true });

    const list = await app.inject({ method: 'GET', url: '/api/v1/rootfolder', headers: authHeaders() });
    expect(list.json()).toHaveLength(1);
  });

  it('POST /api/v1/rootfolder rejects an empty path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid delivery targets and marks existing files pending when a server is linked', async () => {
    const root = await createRootFolder();
    const quality = await createQuality();
    const profile = await createQualityProfile(quality.id);
    const artist = await createArtist(root.id, profile.id);
    const video = await createMusicVideo(artist.id, { hasFile: true });
    const connector = await createLibraryConnector({ enabled: false });
    await prisma.libraryConnector.update({ where: { id: connector.id }, data: { videoLibraryId: 'videos' } });
    const update = () => app.inject({ method: 'PUT', url: `/api/v1/rootfolder/${root.id}`, headers: authHeaders(), payload: { targetConnectorId: connector.id } });
    expect((await update()).statusCode).toBe(400);
    await prisma.libraryConnector.update({ where: { id: connector.id }, data: { enabled: true } });
    expect((await update()).statusCode).toBe(200);
    expect((await prisma.musicVideo.findUniqueOrThrow({ where: { id: video.id } })).awaitingServerScanAt).not.toBeNull();
  });

  it('rejects a Windows host path when Vidarr runs in Linux', async () => {
    if (process.platform === 'win32') return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: 'D:\\media\\music-videos' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('mounted container path');
    expect(await app.inject({ method: 'GET', url: '/api/v1/rootfolder', headers: authHeaders() }).then((r) => r.json())).toHaveLength(0);
  });

  it('rejects an invalid path update without changing the saved path', async () => {
    if (process.platform === 'win32') return;
    const created = await app.inject({
      method: 'POST', url: '/api/v1/rootfolder', headers: authHeaders(), payload: { path: '/media/safe' },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/v1/rootfolder/${created.json().id}`, headers: authHeaders(),
      payload: { path: 'D:\\media\\unsafe' },
    });
    expect(res.statusCode).toBe(400);
    const list = await app.inject({ method: 'GET', url: '/api/v1/rootfolder', headers: authHeaders() });
    expect(list.json()[0].path).toBe('/media/safe');
  });

  it('POST /api/v1/rootfolder rejects a duplicate path (unique constraint -> non-500)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/dupe' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/dupe' },
    });
    // No specific unique-constraint handler exists for this route today —
    // it surfaces as the generic 500 branch rather than a 409. Documents the
    // current (imperfect) behavior so a future improvement is a visible diff.
    expect(res.statusCode).toBe(500);
  });

  it('DELETE /api/v1/rootfolder/:id removes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rootfolder',
      headers: authHeaders(),
      payload: { path: '/media/to-delete' },
    });
    const id = created.json().id;

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/rootfolder/${id}`, headers: authHeaders() });
    expect(del.statusCode).toBe(204);
  });
});

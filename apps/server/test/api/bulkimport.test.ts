import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

// Only request validation is covered here — both routes shell out to yt-dlp
// for the real work, which this suite doesn't mock.
describe('bulkimport routes', () => {
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

  it('POST /api/v1/bulkimport/youtube-playlist/preview rejects an empty url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bulkimport/youtube-playlist/preview',
      headers: authHeaders(),
      payload: { url: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/bulkimport/youtube-playlist/commit rejects a missing rootFolderId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bulkimport/youtube-playlist/commit',
      headers: authHeaders(),
      payload: { groups: [], qualityProfileId: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/bulkimport/youtube-playlist/commit accepts an empty group list without touching yt-dlp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bulkimport/youtube-playlist/commit',
      headers: authHeaders(),
      payload: { groups: [], rootFolderId: 1, qualityProfileId: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artistsCreated: 0, videosAdded: 0, skipped: 0 });
  });
});

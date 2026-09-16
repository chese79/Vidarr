import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// The actual GDM/Jellyfin protocol parsing is covered by test/discovery.test.ts
// against a mocked node:dgram socket; this file only needs to verify the
// route's own wiring — auth, request validation, and dispatching to the
// right discovery function per type — so the pipeline module itself is
// mocked directly rather than re-simulating UDP responses through it.
vi.mock('../../src/pipeline/discovery.js', () => ({
  discoverPlexServers: vi.fn().mockResolvedValue([{ host: 'http://10.10.10.5:32400', name: 'myplex' }]),
  discoverJellyfinServers: vi.fn().mockResolvedValue([{ host: 'http://10.10.10.6:8096', name: 'myjellyfin' }]),
}));

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { discoverPlexServers, discoverJellyfinServers } from '../../src/pipeline/discovery.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';

describe('POST /api/v1/libraryconnector/discover', () => {
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
    vi.clearAllMocks();
  });

  it('requires an API key, like every other library connector route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/discover',
      payload: { type: 'plex' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a type with no discovery protocol (e.g. subsonic)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/discover',
      headers: authHeaders(),
      payload: { type: 'subsonic' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('dispatches to Plex discovery for type "plex"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/discover',
      headers: authHeaders(),
      payload: { type: 'plex' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ host: 'http://10.10.10.5:32400', name: 'myplex' }]);
    expect(discoverPlexServers).toHaveBeenCalledTimes(1);
    expect(discoverJellyfinServers).not.toHaveBeenCalled();
  });

  it('dispatches to Jellyfin discovery for type "jellyfin"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/libraryconnector/discover',
      headers: authHeaders(),
      payload: { type: 'jellyfin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ host: 'http://10.10.10.6:8096', name: 'myjellyfin' }]);
    expect(discoverJellyfinServers).toHaveBeenCalledTimes(1);
    expect(discoverPlexServers).not.toHaveBeenCalled();
  });
});

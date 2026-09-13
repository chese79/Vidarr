import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

// Only the "no IMVDb key configured" path is covered here — the success path
// calls the real IMVDb HTTP API and isn't exercised by this test suite (no
// network mocking in place yet; see the coverage note for other
// external-integration routes).
describe('imvdb routes', () => {
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

  it('GET /api/v1/imvdb/search-artists returns 428 when no IMVDb key is configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/imvdb/search-artists?q=test',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(428);
    expect(res.json().error).toContain('IMVDb API key is not configured');
  });

  it('GET /api/v1/imvdb/artist/:slug/videos returns 428 when no IMVDb key is configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/imvdb/artist/some-slug/videos',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(428);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings } from '../support/db.js';
import { TEST_API_KEY, authHeaders } from '../support/http.js';

describe('system routes', () => {
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

  it('GET /api/v1/system/task computes nextRunAt from lastRunAt + intervalMs', async () => {
    const lastRunAt = new Date('2026-01-01T00:00:00.000Z');
    await prisma.scheduledTask.create({
      data: { name: 'test-job', intervalMs: 60_000, lastRunAt },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/system/task', headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({
      name: 'test-job',
      nextRunAt: new Date(lastRunAt.getTime() + 60_000).toISOString(),
    });
  });

  it('GET /api/v1/system/task returns null nextRunAt for a task that has never run', async () => {
    await prisma.scheduledTask.create({ data: { name: 'never-run', intervalMs: 60_000 } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/system/task', headers: authHeaders() });
    expect(res.json()[0].nextRunAt).toBeNull();
  });

  it('POST /api/v1/system/task/:name/run 404s for an unknown job name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/system/task/not-a-real-job/run',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().ok).toBe(false);
  });

  it('POST /api/v1/system/regenerate-library-metadata succeeds with nothing to process', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/system/regenerate-library-metadata',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ written: 0, failed: 0 });
  });

  it('GET /api/v1/log respects the limit query param', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.activityLog.create({ data: { level: 'info', source: 'test', message: `event ${i}` } });
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/log?limit=3', headers: authHeaders() });
    expect(res.json()).toHaveLength(3);
  });
});

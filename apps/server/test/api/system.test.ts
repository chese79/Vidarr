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

  it('saves daily timing, zone, automatic window and disabled state without losing history', async () => {
    const lastRunAt = new Date('2026-01-01T00:00:00Z');
    await prisma.scheduledTask.create({ data: { name: 'Library Sync', intervalMs: 86_400_000, lastRunAt, lastResult: 'success' } });
    const payload = { scheduleType: 'daily', timeOfDay: '03:00', timeZone: 'America/Chicago', enabled: true, windowStart: '02:00', windowEnd: '10:00' };
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/system/task/Library%20Sync', headers: authHeaders(), payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ ...payload, lastRunAt: lastRunAt.toISOString(), lastResult: 'success' });
    expect(new Date(saved.json().nextRunAt).getTime()).toBeGreaterThan(Date.now() - 1000);
    const disabled = await app.inject({ method: 'PUT', url: '/api/v1/system/task/Library%20Sync', headers: authHeaders(), payload: { ...payload, enabled: false } });
    expect(disabled.json()).toMatchObject({ enabled: false, nextRunAt: null, lastRunAt: lastRunAt.toISOString() });
  });

  it('rejects invalid schedules and retired tasks without saving a partial edit', async () => {
    await prisma.scheduledTask.create({ data: { name: 'Library Sync', intervalMs: 86_400_000 } });
    for (const payload of [
      { scheduleType: 'daily', timeOfDay: '99:00', timeZone: 'America/Chicago', enabled: true },
      { scheduleType: 'daily', timeOfDay: '12:00', timeZone: 'America/Chicago', enabled: true, windowStart: '02:00', windowEnd: '10:00' },
      { scheduleType: 'interval', intervalMs: 0, enabled: true },
    ]) expect((await app.inject({ method: 'PUT', url: '/api/v1/system/task/Library%20Sync', headers: authHeaders(), payload })).statusCode).toBe(400);
    expect((await prisma.scheduledTask.findUniqueOrThrow({ where: { name: 'Library Sync' } })).intervalMs).toBe(86_400_000);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/system/task/Qualified%20Playback%20Tracking', headers: authHeaders(), payload: {} })).statusCode).toBe(404);
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

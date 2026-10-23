import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings, createLibraryConnector } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
let app: Awaited<ReturnType<typeof buildApp>>;
let id: number;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY });
  id = (await createLibraryConnector()).id;
  await prisma.libraryConnector.update({ where: { id }, data: { videoLibraryId: 'videos' } });
});
it('requires authentication and reports retired tracking without starting observations', async () => {
  const request = { method: 'POST' as const, url: `/api/v1/libraryconnector/${id}/playback-webhook`, payload: { NotificationType: 'PlaybackStart' } };
  expect((await app.inject(request)).statusCode).toBe(401);
  expect((await app.inject({ ...request, headers: authHeaders(), payload: { NotificationType: 'ItemAdded' } })).statusCode).toBe(400);
  expect((await app.inject({ ...request, headers: authHeaders() })).statusCode).toBe(410);
  await prisma.libraryConnector.update({ where: { id }, data: { enabled: false } });
  expect((await app.inject({ ...request, headers: authHeaders() })).statusCode).toBe(409);
});
it('does not accept payload counters or create tracking rows on obsolete webhooks', async () => {
  for (const NotificationType of ['PlaybackProgress', 'PlaybackStop']) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/libraryconnector/${id}/playback-webhook`, headers: authHeaders(), payload: { NotificationType, PlayCount: 9000, PlaybackPositionTicks: 999999999 } });
    expect(response.statusCode).toBe(410);
  }
  expect(await prisma.qualifiedPlayback.count()).toBe(0);
});

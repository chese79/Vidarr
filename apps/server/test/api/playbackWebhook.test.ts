import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings, createLibraryConnector } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
const callbacks = vi.hoisted(() => ({ wake: vi.fn() }));
vi.mock('../../src/pipeline/qualifiedPlayback.js', () => ({ wakeQualifiedPlayback: callbacks.wake, pollQualifiedPlayback: vi.fn() }));
let app: Awaited<ReturnType<typeof buildApp>>;
let id: number;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY }); callbacks.wake.mockClear();
  id = (await createLibraryConnector()).id;
  await prisma.libraryConnector.update({ where: { id }, data: { videoLibraryId: 'videos' } });
});
it('requires API authentication and a valid playback event for an enabled Jellyfin video connector', async () => {
  const request = { method: 'POST' as const, url: `/api/v1/libraryconnector/${id}/playback-webhook`, payload: { NotificationType: 'PlaybackStart' } };
  expect((await app.inject(request)).statusCode).toBe(401);
  expect((await app.inject({ ...request, headers: authHeaders(), payload: { NotificationType: 'ItemAdded' } })).statusCode).toBe(400);
  expect(callbacks.wake).not.toHaveBeenCalled();
  expect((await app.inject({ ...request, headers: authHeaders() })).statusCode).toBe(202);
  expect(callbacks.wake).toHaveBeenCalledOnce();
  await prisma.libraryConnector.update({ where: { id }, data: { enabled: false } });
  expect((await app.inject({ ...request, headers: authHeaders() })).statusCode).toBe(409);
});
it('accepts progress/stop wakeups but never trusts supplied play counts', async () => {
  for (const NotificationType of ['PlaybackProgress', 'PlaybackStop']) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/libraryconnector/${id}/playback-webhook`, headers: authHeaders(), payload: { NotificationType, PlayCount: 9000, PlaybackPositionTicks: 999999999 } });
    expect(response.statusCode).toBe(202);
  }
  expect(await prisma.qualifiedPlayback.count()).toBe(0);
});

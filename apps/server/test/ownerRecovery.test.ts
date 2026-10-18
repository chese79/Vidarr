import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { recoverOwnerLogin } from '../src/pipeline/recoverOwnerLogin.js';
import { hashPassword, verifyPassword } from '../src/pipeline/password.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from './support/db.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb(); await ensureSettings({ apiKey: 'recovery-test-key' });
  await prisma.settings.update({ where: { id: 1 }, data: { adminUsername: 'owner', adminPasswordHash: await hashPassword('old-password'), googleClientId: 'kept-client', googleClientSecret: 'kept-secret', googleAllowedEmail: 'owner@example.test' } });
});
const login = (password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password } });
it('recovers the existing owner and preserves every other setting and library identity', async () => {
  const artist = await createArtist((await createRootFolder()).id, (await createQualityProfile((await createQuality()).id)).id);
  const before = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const result = await recoverOwnerLogin(), after = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  expect(result.username).toBe('owner'); expect(result.password.length).toBeGreaterThanOrEqual(24);
  expect({ ...after, adminPasswordHash: before.adminPasswordHash }).toEqual(before);
  expect(await verifyPassword(result.password, after.adminPasswordHash!)).toBe(true);
  expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toEqual(artist);
  expect((await login('old-password')).statusCode).toBe(401);
  expect((await login(result.password)).json()).toEqual({ apiKey: before.apiKey });
});
it('does not silently create or claim an owner account during console recovery', async () => {
  await prisma.settings.update({ where: { id: 1 }, data: { adminUsername: null, adminPasswordHash: null } });
  const before = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  await expect(recoverOwnerLogin()).rejects.toThrow('No owner account');
  expect(await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).toEqual(before);
});
it('requires the existing API key for password recovery and preserves credentials on failed proof', async () => {
  const before = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  for (const headers of [{}, { 'x-api-key': 'wrong-key' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login/credentials', headers, payload: { username: 'intruder', password: 'new-password' } });
    expect(response.statusCode).toBe(401); expect(response.body).not.toContain(before.adminPasswordHash!);
  }
  expect(await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).toEqual(before);
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login/credentials', headers: { 'x-api-key': before.apiKey! }, payload: { username: 'owner', password: 'new-password' } });
  expect(response.json()).toEqual({ adminUsername: 'owner' });
  expect((await login('new-password')).json()).toEqual({ apiKey: before.apiKey });
  expect((await login('old-password')).statusCode).toBe(401);
});

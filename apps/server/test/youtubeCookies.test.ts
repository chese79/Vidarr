import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { settingsRoutes } from '../src/api/settings.js';
import { cookieSnapshot, validateYoutubeCookies, saveYoutubeCookies, removeYoutubeCookies, youtubeCookiesConfigured } from '../src/providers/youtube/cookies.js';

const cookies = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\ttest-secret\n';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'vidarr-cookie-test-'));
  vi.stubEnv('DATABASE_URL', `file:${path.join(directory, 'test.db')}`);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it('validates format, rejects malformed rows and filters unrelated sessions', () => {
  expect(validateYoutubeCookies(cookies + '.example.com\tTRUE\t/\tTRUE\t0\tSID\tother-secret\n')).not.toContain('other-secret');
  expect(validateYoutubeCookies(cookies.replace('.youtube.com', '#HttpOnly_.youtube.com'))).toContain('#HttpOnly_');
  for (const input of ['secret', '# Netscape HTTP Cookie File\n', cookies.replace('TRUE', 'invalid'), cookies.replace('.youtube.com', '.notyoutube.com'), 'x'.repeat(256 * 1024 + 1)]) {
    expect(() => validateYoutubeCookies(input)).toThrow();
  }
});

it('protects the saved jar from concurrent writes and replacement/removal', async () => {
  expect(await youtubeCookiesConfigured()).toBe(false);
  await saveYoutubeCookies(cookies);
  const args = ['https://www.youtube.com/watch?v=id'];
  const first = (await cookieSnapshot(args))!;
  const second = (await cookieSnapshot(['ytsearch8:Artist']))!;
  expect(first.path).not.toBe(second.path);
  expect(await readFile(first.path, 'utf8')).toContain('test-secret');
  if (process.platform !== 'win32') expect((await stat(first.path)).mode & 0o777).toBe(0o600);
  await expect(saveYoutubeCookies('bad')).rejects.toThrow();
  expect(await youtubeCookiesConfigured()).toBe(true);
  await saveYoutubeCookies(cookies.replace('test-secret', 'replacement'));
  expect(await readFile(first.path, 'utf8')).toContain('test-secret');
  expect(await cookieSnapshot(['https://vimeo.com/1'])).toBeNull();
  expect(await cookieSnapshot(['https://youtube.com.example.com/1'])).toBeNull();
  await removeYoutubeCookies();
  expect(await youtubeCookiesConfigured()).toBe(false);
  expect(await cookieSnapshot(args)).toBeNull();
  await first.cleanup(); await second.cleanup();
  await expect(stat(first.path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('API returns only configuration status and preserves the previous file on invalid upload', async () => {
  const app = Fastify();
  await settingsRoutes(app);
  const url = '/api/v1/config/youtube-cookies';
  try {
    expect((await app.inject({ url })).json()).toEqual({ configured: false });
    const saved = await app.inject({ method: 'PUT', url, payload: { cookies } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ configured: true });
    expect(saved.body).not.toContain('test-secret');
    expect((await app.inject({ method: 'PUT', url, payload: { cookies: 'bad' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url, payload: { cookies: null } })).statusCode).toBe(400);
    expect((await app.inject({ url })).json()).toEqual({ configured: true });
    expect((await app.inject({ method: 'DELETE', url })).json()).toEqual({ configured: false });
  } finally { await app.close(); }
});

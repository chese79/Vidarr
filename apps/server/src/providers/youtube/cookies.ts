import { mkdir, readFile, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { rememberSecrets } from '../../security/redact.js';

function rememberCookieValues(content: string) {
  for (const line of content.split('\n')) {
    const fields = line.split('\t');
    if (fields.length === 7) rememberSecrets({ sessionKey: fields[6] });
  }
}

export const MAX_COOKIE_BYTES = 256 * 1024;

function cookiePath(): string {
  // Prisma resolves relative SQLite URLs against its schema directory.
  const database = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '').split('?')[0];
  const databasePath = path.isAbsolute(database) ? database : path.resolve('prisma', database);
  return path.join(path.dirname(databasePath), 'youtube-cookies.txt');
}

export function validateYoutubeCookies(input: string): string {
  if (Buffer.byteLength(input) > MAX_COOKIE_BYTES) throw new Error('Cookie file must be at most 256 KB');
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)\s*$/.test(lines[0])) {
    throw new Error('Upload a Netscape-format YouTube cookie file');
  }
  const cookies: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim() || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const fields = line.replace(/^#HttpOnly_/, '').split('\t');
    if (fields.length !== 7 || !/^(?:TRUE|FALSE)$/.test(fields[1]) ||
        !/^(?:TRUE|FALSE)$/.test(fields[3]) || !/^\d+$/.test(fields[4]) ||
        !fields[2].startsWith('/') || !fields[5] || fields.some(field => /[\r\0]/.test(field))) {
      throw new Error('Cookie file contains an invalid Netscape cookie row');
    }
    // Discard other sites' sessions, including cookies from a whole-browser export.
    const domain = fields[0].replace(/^\./, '').toLowerCase();
    if (domain === 'youtube.com' || domain.endsWith('.youtube.com')) cookies.push(line);
  }
  if (!cookies.length) throw new Error('Cookie file contains no YouTube cookies');
  return '# Netscape HTTP Cookie File\n' + cookies.join('\n') + '\n';
}

export async function youtubeCookiesConfigured(): Promise<boolean> {
  try { return Boolean(await readFile(cookiePath(), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export async function saveYoutubeCookies(input: string): Promise<void> {
  const content = validateYoutubeCookies(input);
  rememberCookieValues(content);
  const target = cookiePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

export async function removeYoutubeCookies(): Promise<void> {
  await rm(cookiePath(), { force: true });
}

export function isYoutubeRequest(args: string[]): boolean {
  return args.some(arg => {
    if (/^ytsearch\d*:/i.test(arg)) return true;
    try {
      const host = new URL(arg).hostname.toLowerCase();
      return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
    } catch { return false; }
  });
}

export async function cookieSnapshot(args: string[]): Promise<{ path: string; cleanup: () => Promise<void> } | null> {
  if (!isYoutubeRequest(args)) return null;
  let content: string;
  try { content = await readFile(cookiePath(), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  rememberCookieValues(content);
  // yt-dlp writes its cookie jar on exit. Each concurrent process gets its own
  // private copy so it cannot corrupt the saved secret or another transfer.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vidarr-youtube-'));
  const snapshot = path.join(directory, 'cookies.txt');
  try { await writeFile(snapshot, content, { mode: 0o600 }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  return { path: snapshot, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

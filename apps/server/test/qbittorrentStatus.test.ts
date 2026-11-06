import { afterEach, expect, it, vi } from 'vitest';
import { qbittorrentProvider } from '../src/providers/downloadclient/qbittorrent.js';
afterEach(() => vi.unstubAllGlobals());
it.each(['pausedDL', 'stoppedDL', 'checkingResumeData', 'moving', 'unknown', 'futureState'])('never imports %s as completed', async state => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/auth/')
    ? new Response('Ok.', { headers: { 'set-cookie': 'SID=fixture' } })
    : new Response(JSON.stringify([{ state, progress: 0.5, content_path: '/downloads/incomplete' }]))));
  expect(await qbittorrentProvider.getStatus({ host: 'client', port: 8080 } as any, 'hash')).toEqual({ status: 'downloading', progress: 0.5 });
});
it.each(['uploading', 'stalledUP', 'pausedUP', 'stoppedUP'])('imports %s only with completed progress', async state => {
  let progress = 0.9;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/auth/')
    ? new Response('Ok.', { headers: { 'set-cookie': 'SID=fixture' } })
    : new Response(JSON.stringify([{ state, progress, content_path: '/downloads/complete' }]))));
  expect((await qbittorrentProvider.getStatus({ host: 'client', port: 8080 } as any, 'hash')).status).toBe('downloading');
  progress = 1;
  expect((await qbittorrentProvider.getStatus({ host: 'client', port: 8080 } as any, 'hash')).status).toBe('completed');
});

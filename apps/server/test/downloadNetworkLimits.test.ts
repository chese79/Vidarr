import { afterEach, expect, it, vi } from 'vitest';
import { sabnzbdProvider } from '../src/providers/downloadclient/sabnzbd.js';
import { qbittorrentProvider } from '../src/providers/downloadclient/qbittorrent.js';
import { searchIndexer } from '../src/providers/indexer/torznab.js';
import type { DownloadClient, Indexer } from '@prisma/client';

afterEach(() => vi.unstubAllGlobals());
it('bounds external submissions and indexer requests without retrying an ambiguous SAB submission', async () => {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
    signals.push(options.signal as AbortSignal);
    throw new Error('connection lost');
  });
  vi.stubGlobal('fetch', fetch);
  const client = { host: 'localhost', port: 8080 } as DownloadClient;
  await expect(sabnzbdProvider.addDownload(client, 'https://example.test/video.nzb', 'vidarr')).rejects.toThrow('connection lost');
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(qbittorrentProvider.addDownload(client, 'magnet:?xt=urn:btih:' + 'a'.repeat(40), 'vidarr')).rejects.toThrow('connection lost');
  await expect(searchIndexer({ baseUrl: 'https://example.test/api', categories: '[]' } as Indexer, 'song')).rejects.toThrow('connection lost');
  expect(signals.length).toBe(5); // SAB once, safe login retries three times, indexer once.
  expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true);
});

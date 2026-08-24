import type { DownloadClient } from '@prisma/client';
import type { DownloadClientProvider, DownloadStatus, GrabHandle } from './types.js';
import { withRetry } from '../../pipeline/retry.js';

function baseUrl(client: DownloadClient): string {
  return `http://${client.host}:${client.port}`;
}

async function login(client: DownloadClient): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${baseUrl(client)}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: client.username ?? '',
        password: client.password ?? '',
      }),
    });
    const cookie = res.headers.get('set-cookie');
    if (!res.ok || !cookie) {
      throw new Error(`qBittorrent login failed: ${res.status} ${res.statusText}`);
    }
    return cookie.split(';')[0];
  });
}

const MAGNET_HASH = /urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/;

const STATES_DOWNLOADING = new Set([
  'downloading',
  'stalledDL',
  'metaDL',
  'queuedDL',
  'checkingDL',
  'forcedDL',
  'allocating',
]);
const STATES_FAILED = new Set(['error', 'missingFiles']);

export const qbittorrentProvider: DownloadClientProvider = {
  async testConnection(client) {
    try {
      await login(client);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async addDownload(client, downloadUrl, category): Promise<GrabHandle> {
    const match = MAGNET_HASH.exec(downloadUrl);
    if (!match) {
      throw new Error('Only magnet links are currently supported for qBittorrent grabs.');
    }
    const hash = match[1].toLowerCase();
    const cookie = await login(client);

    const form = new FormData();
    form.set('urls', downloadUrl);
    form.set('category', category);
    const res = await fetch(`${baseUrl(client)}/api/v2/torrents/add`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    if (!res.ok) throw new Error(`qBittorrent add failed: ${res.status} ${res.statusText}`);

    return { externalRef: hash };
  },

  async getStatus(client, externalRef): Promise<DownloadStatus> {
    const torrents = await withRetry(async () => {
      const cookie = await login(client);
      const res = await fetch(`${baseUrl(client)}/api/v2/torrents/info?hashes=${externalRef}`, {
        headers: { Cookie: cookie },
      });
      if (!res.ok) throw new Error(`qBittorrent status check failed: ${res.status}`);
      return (await res.json()) as any[];
    });
    const torrent = torrents[0];
    if (!torrent) return { status: 'failed', progress: 0, error: 'Torrent no longer in client' };

    if (STATES_FAILED.has(torrent.state)) {
      return { status: 'failed', progress: 0, error: `qBittorrent state: ${torrent.state}` };
    }
    if (STATES_DOWNLOADING.has(torrent.state)) {
      return { status: 'downloading', progress: Number(torrent.progress ?? 0) };
    }
    return {
      status: 'completed',
      progress: 1,
      contentPath: torrent.content_path || `${torrent.save_path}/${torrent.name}`,
    };
  },
};

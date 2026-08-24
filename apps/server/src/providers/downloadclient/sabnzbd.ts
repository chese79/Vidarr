import type { DownloadClient } from '@prisma/client';
import type { DownloadClientProvider, DownloadStatus, GrabHandle } from './types.js';
import { withRetry } from '../../pipeline/retry.js';

function apiUrl(client: DownloadClient, params: Record<string, string>): string {
  const url = new URL(`http://${client.host}:${client.port}/api`);
  url.searchParams.set('apikey', client.apiKey ?? '');
  url.searchParams.set('output', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export const sabnzbdProvider: DownloadClientProvider = {
  async testConnection(client) {
    try {
      const res = await fetch(apiUrl(client, { mode: 'version' }));
      if (!res.ok) return { ok: false, message: `${res.status} ${res.statusText}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async addDownload(client, downloadUrl, category): Promise<GrabHandle> {
    const res = await fetch(
      apiUrl(client, { mode: 'addurl', name: downloadUrl, cat: category }),
    );
    if (!res.ok) throw new Error(`SABnzbd add failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    if (!body.status || !body.nzo_ids?.[0]) {
      throw new Error(body.error ?? 'SABnzbd rejected the download');
    }
    return { externalRef: body.nzo_ids[0] };
  },

  async getStatus(client, externalRef): Promise<DownloadStatus> {
    const queue = await withRetry(async () => {
      const res = await fetch(apiUrl(client, { mode: 'queue' }));
      if (!res.ok) throw new Error(`SABnzbd queue check failed: ${res.status}`);
      return res.json();
    });
    const inQueue = queue?.queue?.slots?.find((s: any) => s.nzo_id === externalRef);
    if (inQueue) {
      return { status: 'downloading', progress: Number(inQueue.percentage ?? 0) / 100 };
    }

    const history = await withRetry(async () => {
      const res = await fetch(apiUrl(client, { mode: 'history' }));
      if (!res.ok) throw new Error(`SABnzbd history check failed: ${res.status}`);
      return res.json();
    });
    const inHistory = history?.history?.slots?.find((s: any) => s.nzo_id === externalRef);
    if (!inHistory) {
      return { status: 'failed', progress: 0, error: 'Download no longer in client' };
    }
    if (inHistory.status === 'Completed') {
      return { status: 'completed', progress: 1, contentPath: inHistory.storage };
    }
    return { status: 'failed', progress: 0, error: inHistory.fail_message || inHistory.status };
  },
};

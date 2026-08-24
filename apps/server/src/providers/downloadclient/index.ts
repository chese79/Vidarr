import type { DownloadClientProvider } from './types.js';
import { qbittorrentProvider } from './qbittorrent.js';
import { sabnzbdProvider } from './sabnzbd.js';

export * from './types.js';

const PROVIDERS: Record<string, DownloadClientProvider> = {
  qBittorrent: qbittorrentProvider,
  SABnzbd: sabnzbdProvider,
};

export function getDownloadClientProvider(implementation: string): DownloadClientProvider {
  const provider = PROVIDERS[implementation];
  if (!provider) throw new Error(`Unknown download client implementation: ${implementation}`);
  return provider;
}

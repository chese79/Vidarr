import type { DownloadClient } from '@prisma/client';

export interface GrabHandle {
  externalRef: string;
}

export interface DownloadStatus {
  status: 'downloading' | 'completed' | 'failed';
  progress: number; // 0-1
  contentPath?: string;
  error?: string;
}

export interface DownloadClientProvider {
  testConnection(client: DownloadClient): Promise<{ ok: boolean; message?: string }>;
  addDownload(client: DownloadClient, downloadUrl: string, category: string): Promise<GrabHandle>;
  getStatus(client: DownloadClient, externalRef: string, category: string): Promise<DownloadStatus>;
}

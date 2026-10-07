import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { syncConnectorVideos } from './libraryVideoSync.js';
import {
  generatePlaylistFromFilters,
  regenerateSmartPlaylist,
  type GeneratePlaylistResult,
  type PlaylistFilters,
} from './playlistGenerator.js';

export interface ConnectorSyncReport {
  connectorId: number;
  name: string;
  status: 'synced' | 'failed' | 'skipped';
  videoCount?: number;
  message?: string;
}

// Playlists are built from what Plex/Jellyfin currently hold, so the video
// libraries are re-read first rather than trusting whenever a sync last happened
// to succeed. Only connectors that can contribute are synced: with a target
// library that one alone, otherwise every enabled connector with a video library.
// A sync that fails never blocks playlist creation — the playlist is built from the
// last known data and the failure is reported — because the alternative is
// refusing to build anything whenever a media server is briefly unreachable.
export async function syncVideoConnectors(targetConnectorId?: number | null): Promise<ConnectorSyncReport[]> {
  const connectors = await prisma.libraryConnector.findMany({
    where: {
      enabled: true,
      videoLibraryId: { not: null },
      ...(targetConnectorId ? { id: targetConnectorId } : {}),
    },
    orderBy: { id: 'asc' },
  });
  const reports: ConnectorSyncReport[] = [];
  for (const connector of connectors) {
    let supportsVideos = false;
    try { supportsVideos = Boolean(getLibraryConnectorProvider(connector.type).fetchVideos); } catch { /* unknown type */ }
    if (!supportsVideos) continue;

    // Same flag the Library Connectors page reads, and the same guard against two
    // syncs interleaving their "mark everything unavailable, then re-mark" writes.
    const claimed = await prisma.libraryConnector.updateMany({
      where: { id: connector.id, syncRunning: false },
      data: { syncRunning: true, syncProcessed: 0, syncTotal: null },
    });
    if (!claimed.count) {
      reports.push({ connectorId: connector.id, name: connector.name, status: 'skipped', message: 'A sync is already running; using its last results.' });
      continue;
    }
    try {
      const { videoCount } = await syncConnectorVideos(connector, {
        onFetched: (count) => prisma.libraryConnector.update({ where: { id: connector.id }, data: { syncTotal: count } }).then(() => undefined),
      });
      reports.push({ connectorId: connector.id, name: connector.name, status: 'synced', videoCount });
    } catch (err) {
      const message = (err as Error).message;
      await logActivity('warn', 'playlist:video-sync', `${connector.name}: ${message}`);
      reports.push({ connectorId: connector.id, name: connector.name, status: 'failed', message });
    } finally {
      await prisma.libraryConnector.update({ where: { id: connector.id }, data: { syncRunning: false } });
    }
  }
  return reports;
}

export async function generatePlaylistWithSync(
  name: string,
  filters: PlaylistFilters,
  matchMode: 'all' | 'any',
  options: Parameters<typeof generatePlaylistFromFilters>[3] = {},
): Promise<GeneratePlaylistResult & { sync: ConnectorSyncReport[] }> {
  const sync = await syncVideoConnectors(options.targetConnectorId);
  return { ...await generatePlaylistFromFilters(name, filters, matchMode, options), sync };
}

export async function regenerateSmartPlaylistWithSync(
  playlistId: number,
): Promise<Awaited<ReturnType<typeof regenerateSmartPlaylist>> & { sync: ConnectorSyncReport[] }> {
  const playlist = await prisma.playlist.findUnique({ where: { id: playlistId }, select: { targetConnectorId: true } });
  const sync = await syncVideoConnectors(playlist?.targetConnectorId);
  return { ...await regenerateSmartPlaylist(playlistId), sync };
}

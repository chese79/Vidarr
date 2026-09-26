import { prisma } from '../db/client.js';
import { refreshQueue } from '../pipeline/grab.js';
import { runBacklogSearch, runQualityUpgradeSearch } from '../pipeline/autoSearch.js';
import { pruneOldLogs } from '../pipeline/logCleanup.js';
import { pollAndGrabYoutubeSource } from '../pipeline/youtubeSync.js';
import { checkRootFolders } from '../pipeline/rootFolderHealth.js';
import { refreshImvdbMetadata } from '../pipeline/metadataRefresh.js';
import { regenerateSmartPlaylist } from '../pipeline/playlistGenerator.js';
import { republishChangedSmartPlaylist } from '../pipeline/playlistPush.js';
import { reconcilePendingImports } from '../pipeline/pendingImportReconciliation.js';

export interface ScheduledJob {
  name: string;
  defaultIntervalMs: number;
  run: () => Promise<string>;
}

async function pollAllYoutubeSources(): Promise<string> {
  const sources = await prisma.youtubeSource.findMany({ where: { monitored: true } });
  let created = 0;
  let grabbed = 0;
  for (const source of sources) {
    const result = await pollAndGrabYoutubeSource(source.id);
    created += result.created;
    grabbed += result.grabbed;
  }
  return `${sources.length} source(s) polled, ${created} new video(s), ${grabbed} grabbed`;
}

// Fixed-interval jobs are enough for what these actually are (every N minutes/
// seconds, not calendar schedules) — plain setInterval, no cron-string library
// needed. See docs/plan.md's scheduler section.
export const JOBS: ScheduledJob[] = [
  {
    name: 'Pending Import Reconciliation',
    defaultIntervalMs: 5 * 60_000,
    run: async () => {
      const result = await reconcilePendingImports();
      return `${result.confirmed} of ${result.checked} pending import(s) confirmed in playback libraries`;
    },
  },
  {
    name: 'Smart Playlist Regeneration',
    defaultIntervalMs: 15 * 60_000,
    run: async () => {
      const now = Date.now();
      const playlists = await prisma.playlist.findMany({
        where: { kind: 'smart', regenerateIntervalMinutes: { not: null } },
        select: { id: true, lastGeneratedAt: true, regenerateIntervalMinutes: true },
      });
      let regenerated = 0;
      for (const playlist of playlists) {
        if (playlist.lastGeneratedAt && now - playlist.lastGeneratedAt.getTime() < playlist.regenerateIntervalMinutes! * 60_000) continue;
        const result = await regenerateSmartPlaylist(playlist.id);
        await republishChangedSmartPlaylist(playlist.id, result.changed);
        regenerated++;
      }
      return `${regenerated} smart playlist(s) regenerated`;
    },
  },
  {
    name: 'Download Queue Monitor',
    defaultIntervalMs: 20_000,
    run: async () => {
      const r = await refreshQueue();
      return `${r.completed} completed, ${r.failed} failed, ${r.pending} pending`;
    },
  },
  {
    name: 'YouTube Channel Poll',
    defaultIntervalMs: 45 * 60_000,
    run: pollAllYoutubeSources,
  },
  {
    name: 'Missing/Wanted Backlog Search',
    defaultIntervalMs: 6 * 60 * 60_000,
    run: async () => {
      const r = await runBacklogSearch();
      return `${r.grabbed} grabbed, ${r.skipped} skipped`;
    },
  },
  {
    name: 'Root Folder Health Check',
    defaultIntervalMs: 60 * 60_000,
    run: async () => {
      const r = await checkRootFolders();
      return `${r.checked} checked, ${r.inaccessible} inaccessible`;
    },
  },
  {
    name: 'IMVDb Metadata Refresh',
    defaultIntervalMs: 24 * 60 * 60_000,
    run: async () => {
      const r = await refreshImvdbMetadata();
      return `${r.artistsChecked} artist(s) checked, ${r.videosAdded} video(s) added`;
    },
  },
  {
    name: 'Quality Upgrade Search',
    defaultIntervalMs: 12 * 60 * 60_000,
    run: async () => {
      const r = await runQualityUpgradeSearch();
      return `${r.upgraded} upgraded, ${r.skipped} skipped`;
    },
  },
  {
    name: 'Log Cleanup',
    defaultIntervalMs: 24 * 60 * 60_000,
    run: async () => {
      const r = await pruneOldLogs();
      return `${r.activityLogDeleted} activity log entries, ${r.historyDeleted} history entries pruned`;
    },
  },
];

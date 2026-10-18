import { storageIdentity } from '../media/storageIdentity.js';
import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { serverDeliveryPathMatches } from '../pipeline/deliveryPath.js';
import { liveConfiguration } from './policy.js';
import fs from 'node:fs/promises';
import { accessibleRootPath } from '../pipeline/localVideoReview.js';

export async function reconcileRecordingDelivery() {
  const { policy } = await liveConfiguration(); let confirmed = 0;
  for (const kind of ['full', 'song'] as const) {
    const connectorId = kind === 'song' ? policy.songConnectorId : policy.fullConnectorId;
    const libraryId = kind === 'song' ? policy.songLibraryId : policy.fullLibraryId;
    if (!connectorId || !libraryId) continue;
    const configured = await prisma.libraryConnector.findUnique({ where: { id: connectorId } });
    if (!configured?.enabled) continue;
    const connector = { ...configured, videoLibraryId: libraryId };
    const provider = getLibraryConnectorProvider(connector.type);
    if (!provider.fetchVideos) continue;
    try {
      await provider.refreshVideoLibrary?.(connector);
      const videos = await provider.fetchVideos(connector);
      const section = (await provider.listSections?.(connector))?.find(value => value.id === libraryId);
      if (!section) throw new Error('The configured playback library is unavailable; ownership was retained');
      const existingCopies = await prisma.recordingServerCopy.findMany({ where: { connectorId, libraryId,
        part: { recording: { catalogType: 'live', deletionState: null } } }, include: { part: true } });
      for (const copy of existingCopies) {
        const matches = videos.filter(video => video.externalId === copy.externalId && video.path === copy.expectedPath
          && (copy.part.durationSeconds == null || video.durationSeconds == null || Math.abs(copy.part.durationSeconds - video.durationSeconds) <= 10));
        const same = matches.length === 1 ? matches[0] : undefined;
        // Server-only parts deliberately have no local path. Recover their exact
        // retained server identity independently of the local delivery matcher.
        if (Boolean(same) !== copy.available) {
          const changed = await prisma.recordingServerCopy.updateMany({ where: { id: copy.id, part: { recording: { catalogType: 'live', deletionState: null } } },
            data: { available: Boolean(same), ...(same ? { confirmedAt: new Date(), playCount: same.playCount } : {}) } });
          if (same) confirmed += changed.count;
        }
      }
      let afterId = 0;
      for (;;) {
        const parts = await prisma.recordingPart.findMany({ where: { available: true,
          id: { gt: afterId },
          recording: { catalogType: 'live', deletionState: null, claimedCoverage: kind === 'song' ? 'individualSong' : { not: 'individualSong' } },
          serverCopies: { none: { connectorId, libraryId, available: true } } }, include: { rootFolder: true, recording: true }, orderBy: { id: 'asc' }, take: 100 });
        for (const part of parts) {
          if (!part.path || !part.rootFolder) continue;
          const partPath = part.path, rootPath = part.rootFolder.path;
          // Exact mapped file identity is authoritative; Plex may display a filename-derived
          // part title because it does not consume music-video NFO titles.
          const matches = videos.filter(video => serverDeliveryPathMatches(partPath, rootPath, video.path)
            && (part.durationSeconds == null || video.durationSeconds == null || Math.abs(part.durationSeconds - video.durationSeconds) <= 10));
          if (matches.length !== 1 || !matches[0].path) continue;
          const video = matches[0];
          const existing = await prisma.recordingServerCopy.findUnique({ where: { connectorId_libraryId_externalId: { connectorId, libraryId, externalId: video.externalId } } });
          if (existing && existing.partId !== part.id) continue;
          const saved = await prisma.$transaction(async tx => {
            if (!await tx.recording.count({ where: { id: part.recordingId, deletionState: null, catalogType: 'live' } })) return false;
            await tx.recordingServerCopy.upsert({ where: { partId_connectorId: { partId: part.id, connectorId } }, create: {
              partId: part.id, connectorId, libraryId, externalId: video.externalId, expectedPath: video.path!, playCount: video.playCount,
            }, update: { libraryId, externalId: video.externalId, expectedPath: video.path!, available: true, confirmedAt: new Date(), playCount: video.playCount } });
            return true;
          });
          if (saved) confirmed++;
        }
        if (parts.length < 100) break;
        afterId = parts[parts.length - 1].id;
      }
    } catch (error) { await logActivity('warn', 'live-delivery', error); }
  }
  return `${confirmed} recording parts confirmed on their target playback server`;
}

export async function auditLocalRecordingAvailability() {
  const roots = await prisma.rootFolder.findMany({ where: { recordingParts: { some: {} } } });
  let lost = 0;
  for (const root of roots) {
    try {
      const accessible = await accessibleRootPath(root.path);
      const stat = await fs.stat(accessible);
      if (!stat.isDirectory()) continue;
      const identity = await storageIdentity(accessible);
      if (!identity) continue;
      let afterId = 0;
      for (;;) {
        const parts = await prisma.recordingPart.findMany({ where: { rootFolderId: root.id, storageIdentity: identity, available: true, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: 500 });
        for (const part of parts) {
          if (!part.path) continue;
          try { await fs.stat(part.path); }
          catch (error) {
            // Only a successful root check and explicit missing-file result establish local loss.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
            await prisma.recordingPart.update({ where: { id: part.id }, data: { available: false } }); lost++;
          }
        }
        if (parts.length < 500) break;
        afterId = parts[parts.length - 1].id;
      }
    } catch { /* An unmounted/inaccessible root is not proof that its files were deleted. */ }
  }
  return `${lost} confirmed local recording losses`;
}

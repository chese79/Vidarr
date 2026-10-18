import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma, logActivity } from '../db/client.js';
import { redactMessage } from '../security/redact.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { accessibleRootPath } from './localVideoReview.js';
import { isPathWithinRoot } from './pathContainment.js';
import { normalizeTitle } from './normalize.js';

const ACTIVE = [...ACTIVE_DOWNLOAD_STATUSES];
const INITIAL_DELAY_MS = 5 * 60_000;
const RETRY_DELAY_MS = 40 * 60_000;
const targetSchema = z.object({ libraryVideoId: z.number().int(), connectorId: z.number().int(), externalId: z.string(), expectedPath: z.string(), libraryId: z.string().nullable(), host: z.string(), type: z.string() });
const snapshotSchema = z.object({ files: z.array(z.string()), targets: z.array(targetSchema), identities: z.array(z.string()) });
type Snapshot = z.infer<typeof snapshotSchema>;
export class VideoDeletionError extends Error { constructor(message: string, readonly statusCode = 409) { super(message); } }

function mappedPath(value: string): string {
  const windows = /^([a-z]):[\\/](.*)$/i.exec(value);
  return process.platform !== 'win32' && windows ? path.join('/mnt', windows[1].toLowerCase(), ...windows[2].split(/[\\/]+/)) : value;
}

export async function checkLocalPath(filePath: string): Promise<void> {
  if (!path.isAbsolute(filePath)) throw new VideoDeletionError('Local file path is not absolute; correct the root mapping before deleting.');
  const roots = await prisma.rootFolder.findMany({ select: { path: true } });
  let root: string | undefined;
  for (const configured of roots) {
    if (!isPathWithinRoot(mappedPath(configured.path), filePath)) continue;
    try { root = await fs.realpath(await accessibleRootPath(configured.path)); break; } catch { /* try another configured root */ }
  }
  if (!root) throw new VideoDeletionError('The file is outside an accessible configured media root; restore its mount before deleting.');
  let stat;
  try { stat = await fs.lstat(filePath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || !isPathWithinRoot(root, await fs.realpath(filePath))) {
    throw new VideoDeletionError('Refusing to delete a non-file, symlink or file outside the real media root.');
  }
}

export async function localBundle(filePath: string): Promise<string[]> {
  const local = mappedPath(filePath);
  await checkLocalPath(local);
  const base = path.basename(local, path.extname(local));
  const files = [local];
  let entries;
  try { entries = await fs.readdir(path.dirname(local), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    const suffix = entry.name.slice(base.length);
    if (entry.isFile() && entry.name.startsWith(base) && (suffix.startsWith('.') || /^-(thumb|poster|fanart|banner|clearart|landscape)\./i.test(suffix))
      && /\.(nfo|jpg|jpeg|png|webp|srt|vtt|ass)$/i.test(entry.name)) files.push(path.join(path.dirname(local), entry.name));
  }
  for (const file of files) await checkLocalPath(file);
  return files;
}

export async function deleteMusicVideo(id: number, confirmed: boolean): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { warnBeforeDelete: true } });
  if ((settings?.warnBeforeDelete ?? true) && !confirmed) throw new VideoDeletionError('Deletion confirmation required. This removes local files and confirmed matched server copies.');
  const video = await prisma.musicVideo.findUnique({ where: { id }, include: {
    file: true, acquisitionSources: true, libraryVideos: { where: { matchConfidence: null }, include: { connector: true } },
  } });
  if (!video) throw new VideoDeletionError('Music video not found', 404);
  if (video.catalogKind === 'liveClassified') throw new VideoDeletionError('Delete this recording from Live to preserve its performance history.');
  if (await prisma.recording.count({ where: { musicVideoId: id, catalogType: 'live', reviewStatus: { not: 'returnedToMusicVideos' } } })) throw new VideoDeletionError('This video has live recording ownership; use the Live deletion workflow.');
  if (video.deletionState === 'running' || video.deletionState === 'pending') throw new VideoDeletionError('Deletion is already scheduled or running.');
  if (await prisma.downloadQueueItem.count({ where: { musicVideoId: id, status: { in: ACTIVE } } })) {
    throw new VideoDeletionError('Remove or finish this video’s active/waiting download in Queue before deleting.');
  }
  const targets = video.libraryVideos.filter(v => ['jellyfin', 'plex'].includes(v.connector.type)).map(v => ({ libraryVideoId: v.id, connectorId: v.connectorId,
    externalId: v.externalId, expectedPath: v.path ?? '', libraryId: v.connector.videoLibraryId, host: v.connector.host, type: v.connector.type }));
  const identities = new Set<string>();
  if (video.imvdbVideoId) identities.add(`imvdb:${video.imvdbVideoId}`);
  if (video.youtubeVideoId) identities.add(`youtube:${video.youtubeVideoId}`);
  for (const source of video.acquisitionSources) if (source.provider === 'youtube') {
    let externalId = source.externalId;
    if (!externalId) { try { const url = new URL(source.url); externalId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v'); } catch { /* no ID */ } }
    if (externalId) identities.add(`youtube:${externalId}`);
  }
  if (!identities.size) identities.add(`title:${normalizeTitle(video.title)}`);
  if (video.file) identities.add(`local:${video.file.path}`);
  const snapshot: Snapshot = video.deletionTargets ? snapshotSchema.parse(JSON.parse(video.deletionTargets)) : {
    files: video.file ? await localBundle(video.file.path) : [], targets: [], identities: [...identities],
  };
  for (const target of targets) if (!snapshot.targets.some(t => t.connectorId === target.connectorId && t.externalId === target.externalId)) snapshot.targets.push(target);
  for (const identity of identities) if (!snapshot.identities.includes(identity)) snapshot.identities.push(identity);
  if (video.file && await prisma.musicVideoFile.count({ where: { path: video.file.path, musicVideoId: { not: id } } })) throw new VideoDeletionError('Another video owns the same local path; resolve ownership before deleting.');
  await prisma.$transaction(async tx => {
    const claimed = await tx.musicVideo.updateMany({ where: { id, OR: [{ deletionState: null }, { deletionState: 'failed' }] },
      data: { deletionState: 'pending', deletionError: null, deletionTargets: JSON.stringify(snapshot), ignored: true, monitored: false,
        deletionNextAttemptAt: new Date(Date.now() + INITIAL_DELAY_MS) } });
    if (!claimed.count) throw new VideoDeletionError('Deletion state changed; refresh and try again.');
    if (await tx.downloadQueueItem.count({ where: { musicVideoId: id, status: { in: ACTIVE } } })) throw new VideoDeletionError('A download started; finish or remove it from Queue first.');
  });
}

async function performVideoDeletion(id: number, now: Date): Promise<void> {
  try {
    const claimed = await prisma.musicVideo.updateMany({ where: { id, deletionState: { in: ['pending', 'failed'] }, deletionNextAttemptAt: { lte: now } },
      data: { deletionState: 'running', deletionAttempts: { increment: 1 } } });
    if (!claimed.count) return;
    const video = await prisma.musicVideo.findUniqueOrThrow({ where: { id }, include: { file: true } });
    if (await prisma.recording.count({ where: { musicVideoId: id, catalogType: 'live', reviewStatus: { not: 'returnedToMusicVideos' } } })) throw new VideoDeletionError('Live recording ownership changed; resolve its classification before deletion.');
    const snapshot = snapshotSchema.parse(JSON.parse(video.deletionTargets ?? 'null'));
    if (video.file && !snapshot.files.includes(mappedPath(video.file.path))) throw new Error('Owned file changed after deletion was scheduled; reconcile ownership before retrying.');
    if (await prisma.downloadQueueItem.count({ where: { musicVideoId: id, status: { in: ACTIVE } } })) throw new Error('A download is active; waiting for it to finish before deletion.');
    if (video.file && await prisma.musicVideoFile.count({ where: { path: video.file.path, musicVideoId: { not: id } } })) throw new Error('Another video owns the same local path; resolve ownership before deletion.');
    const remotes = [];
    for (const target of snapshot.targets) {
      const connector = await prisma.libraryConnector.findUnique({ where: { id: target.connectorId } });
      if (!connector || connector.videoLibraryId !== target.libraryId || connector.host !== target.host || connector.type !== target.type) throw new VideoDeletionError('A matched server or selected library changed; restore its configuration before retrying deletion.');
      const provider = getLibraryConnectorProvider(connector.type);
      if (!provider.verifyVideoDeletion || !provider.deleteVideo || !provider.isVideoInUse) throw new VideoDeletionError('This server does not support verified video deletion.');
      remotes.push({ connector, provider, target });
    }
    // Validate every target before any destructive action; retry is idempotent.
    for (const file of snapshot.files) await checkLocalPath(file);
    for (const remote of remotes) await remote.provider.verifyVideoDeletion!(remote.connector, remote.target);
    for (const remote of remotes) if (await remote.provider.isVideoInUse!(remote.connector, remote.target.externalId)) {
      throw new Error('Video is in a playback session (playing or paused); deletion deferred.');
    }
    for (const remote of remotes) await remote.provider.deleteVideo!(remote.connector, remote.target);
    for (const file of snapshot.files) {
      await checkLocalPath(file);
      await fs.unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
    await prisma.$transaction(async tx => {
      const bridges = await tx.recording.findMany({ where: { musicVideoId: id } });
      for (const bridge of bridges) {
        if (bridge.catalogType === 'live' && bridge.reviewStatus !== 'returnedToMusicVideos') throw new VideoDeletionError('This entry has live recording ownership; delete it from Live.');
        await tx.recordingServerCopy.deleteMany({ where: { part: { recordingId: bridge.id } } });
        for (const part of await tx.recordingPart.findMany({ where: { recordingId: bridge.id } }))
          await tx.recordingPart.update({ where: { id: part.id }, data: { available: false, path: `deleted:${part.id}:${part.path}` } });
        await tx.recording.update({ where: { id: bridge.id }, data: { musicVideoId: null, reviewStatus: 'deleted', deletionState: 'deleted', evidence: JSON.stringify({ ...JSON.parse(bridge.evidence), retiredQualifiedPlays: video.qualifiedPlayCount, retiredNativePlays: video.file?.playCount ?? null }) } });
      }
      await tx.deletedVideoRecord.upsert({ where: { originalMusicVideoId: id }, update: {}, create: {
        originalMusicVideoId: id, artistId: video.artistId, title: video.title, identities: JSON.stringify(snapshot.identities),
      } });
      const youtubeIds = snapshot.identities.filter(k => k.startsWith('youtube:')).map(k => k.slice(8));
      const localPaths = snapshot.identities.filter(k => k.startsWith('local:')).map(k => k.slice(6));
      await tx.videoReviewCandidate.deleteMany({ where: { artistId: video.artistId, OR: [
        { source: 'youtube', externalId: { in: youtubeIds } }, { source: 'local', filePath: { in: localPaths } },
      ] } });
      await tx.libraryVideo.deleteMany({ where: { id: { in: snapshot.targets.map(t => t.libraryVideoId) }, musicVideoId: id, matchConfidence: null } });
      await tx.musicVideo.delete({ where: { id } });
    });
    await logActivity('info', 'video-deletion', `Deleted video ${id}; local bundle and ${snapshot.targets.length} confirmed server copies removed.`).catch(() => {});
  } catch (error) {
    const message = redactMessage(error);
    await prisma.musicVideo.updateMany({ where: { id }, data: { deletionState: 'failed', deletionError: message, deletionNextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS) } });
    await logActivity('warn', 'video-deletion', `Deletion ${id} deferred for 40 minutes: ${message}`).catch(() => {});
  }
}

export async function recoverInterruptedVideoDeletions(): Promise<void> {
  await prisma.musicVideo.updateMany({ where: { deletionState: 'running' }, data: { deletionState: 'failed', deletionError: 'Deletion interrupted by restart; automatic retry scheduled.', deletionNextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS) } });
}

let processing = false;
export async function processPendingVideoDeletions(now = new Date()): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const videos = await prisma.musicVideo.findMany({ where: { deletionState: { in: ['pending', 'failed'] }, deletionNextAttemptAt: { lte: now } },
      select: { id: true }, orderBy: [{ deletionNextAttemptAt: 'asc' }, { id: 'asc' }], take: 10 });
    for (const video of videos) await performVideoDeletion(video.id, now);
  } finally { processing = false; }
}

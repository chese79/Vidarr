import fs from 'node:fs/promises';
import path from 'node:path';
import { placeFile, type TransferMode } from './transfer.js';
import { writeLibraryMetadata, type LibraryMetadata } from './libraryConvention.js';

// Only companions belonging to this video are imported. Never move unrelated
// directory contents, symlinks, downloader control files, or another video.
const SIDECAR = /\.(nfo|json|xml|jpg|jpeg|png|webp|srt|vtt|ass|ssa|sub|idx|txt)$/i;

export async function stageImportBundle(source: string, destination: string, mode: TransferMode, metadata: LibraryMetadata) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.vidarr-import-'));
  const sourceBase = path.basename(source, path.extname(source));
  const destinationBase = path.basename(destination, path.extname(destination));
  const sources = [source];
  const installed: { destination: string; backup?: string }[] = [];
  const rollback = async () => {
    for (const item of [...installed].reverse()) {
      await fs.unlink(item.destination);
      if (item.backup) await fs.rename(item.backup, item.destination);
    }
    await fs.rm(staging, { recursive: true, force: true });
  };
  try {
    const stagedVideo = path.join(staging, path.basename(destination));
    // A move keeps its source intact until metadata and DB recording succeed.
    await placeFile(source, stagedVideo, mode === 'move' ? 'copy' : mode);
    for (const entry of await fs.readdir(path.dirname(source), { withFileTypes: true })) {
      const suffix = entry.name.slice(sourceBase.length);
      if (!entry.isFile() || !entry.name.startsWith(sourceBase)
        || !(suffix.startsWith('.') || /^-(thumb|poster|fanart|banner|clearart|landscape)\./i.test(suffix))
        || !SIDECAR.test(entry.name)) continue;
      const companion = path.join(path.dirname(source), entry.name);
      await fs.copyFile(companion, path.join(staging, `${destinationBase}${suffix}`));
      sources.push(companion);
    }
    await writeLibraryMetadata(stagedVideo, metadata, { preserveExisting: true });
    for (const entry of await fs.readdir(staging, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const target = path.join(path.dirname(destination), entry.name);
      const backup = path.join(staging, `${entry.name}.backup`);
      let hasBackup = false;
      try {
        const existing = await fs.lstat(target);
        if (!existing.isFile()) throw new Error(`Import destination is not a regular file: ${target}`);
        await fs.rename(target, backup);
        hasBackup = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try { await fs.rename(path.join(staging, entry.name), target); }
      catch (error) {
        if (hasBackup) await fs.rename(backup, target);
        throw error;
      }
      installed.push({ destination: target, backup: hasBackup ? backup : undefined });
    }
    return {
      rollback,
      commit: async () => {
        // Failed cleanup leaves an extra copy, never a lost download.
        if (mode === 'move') for (const original of sources) {
          if (!installed.some(item => path.resolve(item.destination) === path.resolve(original))) {
            await fs.unlink(original).catch(() => {});
          }
        }
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    await rollback();
    throw error;
  }
}

import { prepareImportDirectory, assertImportBundleOwnership, type ImportOwner } from '../media/importDestination.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { placeFile, type TransferMode } from './transfer.js';
import { writeLibraryMetadata, type LibraryMetadata } from './libraryConvention.js';
import { ownsSidecar } from '../media/sidecarOwnership.js';

// Only companions belonging to this video are imported. Never move unrelated
// directory contents, symlinks, downloader control files, or another video.
const SIDECAR = /\.(nfo|json|xml|jpg|jpeg|png|webp|srt|vtt|ass|ssa|sub|idx|txt)$/i;

export async function stageImportBundle(source: string, destination: string, mode: TransferMode, metadata: LibraryMetadata, options?: { root: string; owner: ImportOwner; managedPath?: string }) {
  if (options) await prepareImportDirectory(options.root, destination);
  else await fs.mkdir(path.dirname(destination), { recursive: true });
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
    if (mode === 'move') {
      // Retain the source for rollback without copying same-filesystem bytes.
      try { await fs.link(source, stagedVideo); }
      catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await placeFile(source, stagedVideo, 'copy');
      }
    } else await placeFile(source, stagedVideo, mode);
    const entries = await fs.readdir(path.dirname(source), { withFileTypes: true });
    for (const entry of entries) {
      const suffix = entry.name.slice(sourceBase.length);
      if (!entry.isFile() || !ownsSidecar(path.basename(source), entry.name, entries.map(value => value.name))
        || !SIDECAR.test(entry.name)) continue;
      const companion = path.join(path.dirname(source), entry.name);
      await fs.copyFile(companion, path.join(staging, `${destinationBase}${suffix}`));
      sources.push(companion);
    }
    await writeLibraryMetadata(stagedVideo, metadata, { preserveExisting: true });
    const bundleEntries = (await fs.readdir(staging, { withFileTypes: true })).filter(entry => entry.isFile());
    if (options) {
      await prepareImportDirectory(options.root, destination);
      await assertImportBundleOwnership(destination, bundleEntries.map(entry => path.join(path.dirname(destination), entry.name)), options.owner, options.managedPath);
      for (const entry of bundleEntries) {
        const target = path.join(path.dirname(destination), entry.name);
        const exists = await fs.lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
        const sameStem = options.managedPath && path.join(path.dirname(options.managedPath), path.basename(options.managedPath, path.extname(options.managedPath))) === path.join(path.dirname(destination), destinationBase);
        if (exists && !sameStem && path.resolve(source) !== path.resolve(destination)) throw new Error('Untracked import bundle destination exists; retained for review');
      }
    }
    for (const entry of bundleEntries) {
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

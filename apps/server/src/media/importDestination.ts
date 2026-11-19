import { ownsSidecar } from './sidecarOwnership.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinRoot } from '../pipeline/pathContainment.js';
import { assertExclusiveLocalFiles } from './localFileOwnership.js';

export interface ImportOwner { musicVideoId?: number; recordingId?: number }

// Check existing ancestors before mkdir: a symlink must not create even temporary
// directories outside the root. Recheck the completed directory before placement.
export async function prepareImportDirectory(root: string, destination: string) {
  if (!isPathWithinRoot(root, destination)) throw new Error('Import destination escaped its configured root');
  const physicalRoot = await fs.realpath(root);
  let ancestor = path.dirname(destination);
  for (;;) {
    try {
      const physical = await fs.realpath(ancestor);
      if (physical !== physicalRoot && !isPathWithinRoot(physicalRoot, physical)) throw new Error('Import destination escaped through a symlink');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const directory = await fs.realpath(path.dirname(destination));
  if (directory !== physicalRoot && !isPathWithinRoot(physicalRoot, directory)) throw new Error('Import directory escaped through a symlink');
}

// Every bundle reserves its video stem, across MV and Live owners and extensions.
// Two videos may not share NFO/artwork even when their video paths differ.
export async function assertImportBundleOwnership(destination: string, targets: string[], owner: ImportOwner, managedPath?: string) {
  await assertExclusiveLocalFiles(targets, owner, undefined, destination);
  const directory = await fs.readdir(path.dirname(destination));
  const companionOwners = directory.filter(name => path.resolve(path.dirname(destination), name) !== (managedPath && path.resolve(managedPath)));
  for (const target of targets) {
    if (target !== destination && !ownsSidecar(path.basename(destination), path.basename(target), companionOwners)) {
      throw new Error('Import sidecar ownership is ambiguous; retain the bundle for review');
    }
  }
  const video = /\.(mp4|mkv|webm|avi|mov|m4v|mpg|mpeg|ts|m2ts|wmv|flv)$/i;
  const base = path.basename(destination, path.extname(destination));
  if (directory.some(name => video.test(name) && path.basename(name, path.extname(name)) === base && name !== path.basename(destination) && path.resolve(path.dirname(destination), name) !== (managedPath && path.resolve(managedPath)))) {
    throw new Error('Another video shares this bundle stem; retain both files for review');
  }
}

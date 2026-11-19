import { ownsSidecar } from './sidecarOwnership.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';

// Also compare old, noncanonical stored paths. Normalizing only new registrations
// would leave pre-existing aliases able to delete another catalog entry's file.
export async function canonicalLocalPath(filename: string): Promise<string> {
  let resolved: string;
  try { resolved = await fs.realpath(filename); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { resolved = path.join(await fs.realpath(path.dirname(filename)), path.basename(filename)); }
    catch (parentError) {
      if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError;
      resolved = path.resolve(filename);
    }
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class LocalFileOwnershipError extends Error { readonly statusCode = 409; }

export async function assertExclusiveLocalFiles(files: string[], owner: { recordingId?: number; musicVideoId?: number | null }, db: Prisma.TransactionClient = prisma, reserveBundle?: string) {
  const targets = new Set(await Promise.all(files.map(canonicalLocalPath)));
  if (!targets.size) return;
  const stem = (filename: string) => filename.slice(0, -path.extname(filename).length);
  const bundleStem = reserveBundle ? stem(await canonicalLocalPath(reserveBundle)) : undefined;
  const targetPaths = [...targets];
  const conflicts = (filename: string) => targets.has(filename) || bundleStem !== undefined && (
    stem(filename) === bundleStem || targetPaths.some(target => path.dirname(target) === path.dirname(filename)
      && ownsSidecar(path.basename(filename), path.basename(target), [path.basename(filename)]))
  );
  let cursor = 0;
  for (;;) {
    const rows = await db.recordingPart.findMany({ where: { id: { gt: cursor }, path: { not: null }, recordingId: owner.recordingId ? { not: owner.recordingId } : undefined,
      recording: { AND: [{ OR: [{ deletionState: null }, { deletionState: { not: 'deleted' } }] },
        ...(owner.musicVideoId ? [{ OR: [{ musicVideoId: null }, { musicVideoId: { not: owner.musicVideoId } }] }] : [])] } }, select: { id: true, path: true }, orderBy: { id: 'asc' }, take: 200 });
    const paths = await Promise.all(rows.map(row => canonicalLocalPath(row.path!)));
    if (paths.some(conflicts)) throw new LocalFileOwnershipError('Another recording owns this physical file or import bundle stem; resolve shared ownership before continuing');
    if (rows.length < 200) break;
    cursor = rows[rows.length - 1].id;
  }
  cursor = 0;
  for (;;) {
    const rows = await db.musicVideoFile.findMany({ where: { id: { gt: cursor }, ...(owner.musicVideoId ? { musicVideoId: { not: owner.musicVideoId } } : {}) }, select: { id: true, path: true }, orderBy: { id: 'asc' }, take: 200 });
    const paths = await Promise.all(rows.map(row => canonicalLocalPath(row.path)));
    if (paths.some(conflicts)) throw new LocalFileOwnershipError('A music video owns this physical file or import bundle stem; use its classification review instead');
    if (rows.length < 200) break;
    cursor = rows[rows.length - 1].id;
  }
}

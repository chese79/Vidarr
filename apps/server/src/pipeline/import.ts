import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { renderNamingFormat } from '@vidarr/shared-types';
import { placeFile, type TransferMode } from './transfer.js';
import { writeLibraryMetadata } from './libraryConvention.js';
import { isPathWithinRoot } from './pathContainment.js';

export interface ImportResult {
  path: string;
  sizeBytes: bigint;
}

export class InsufficientDiskSpaceError extends Error {}

// Shared by every source (YouTube, indexer/download-client, and quality
// upgrades) — once a grab produces a file on disk, it's imported the same way.
export async function importDownloadedFile(
  musicVideoId: number,
  sourcePath: string,
  qualityName: string,
): Promise<ImportResult> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({
    where: { id: musicVideoId },
    include: { artist: { include: { rootFolder: true } } },
  });
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const existingFile = await prisma.musicVideoFile.findUnique({ where: { musicVideoId } });

  const sourceStat = await fs.stat(sourcePath);
  const rootFolder = musicVideo.artist.rootFolder;
  if (rootFolder.freeSpaceBytes !== null) {
    const minFreeBytes = BigInt(settings.minFreeSpaceMb) * 1024n * 1024n;
    const remainingAfter = rootFolder.freeSpaceBytes - BigInt(sourceStat.size);
    if (remainingAfter < minFreeBytes) {
      throw new InsufficientDiskSpaceError(
        `Importing this file would leave ${rootFolder.path} below the configured minimum free space (${settings.minFreeSpaceMb} MB).`,
      );
    }
  }

  const relativePath = renderNamingFormat(settings.namingFormat, {
    artistName: musicVideo.artist.name,
    videoTitle: musicVideo.title,
    year: musicVideo.releaseYear,
    quality: qualityName,
  });
  const destPath = path.join(rootFolder.path, `${relativePath}${path.extname(sourcePath)}`);

  if (!isPathWithinRoot(rootFolder.path, destPath)) {
    throw new Error(
      `Refusing to import outside the configured root folder (computed path escaped ${rootFolder.path}).`,
    );
  }

  await placeFile(sourcePath, destPath, settings.transferMode as TransferMode);
  const stat = await fs.stat(destPath);

  await writeLibraryMetadata(destPath, {
    artistName: musicVideo.artist.name,
    title: musicVideo.title,
    year: musicVideo.releaseYear,
    director: musicVideo.director,
    thumbnailUrl: musicVideo.thumbnailUrl,
  });

  // A quality upgrade renames to a different filename (the {Quality} token
  // changes) — the old file is now an orphan once the new one is in place.
  if (existingFile && existingFile.path !== destPath) {
    await fs.unlink(existingFile.path).catch(() => {});
  }

  const quality = await prisma.quality.findUnique({ where: { name: qualityName } });

  await prisma.musicVideoFile.upsert({
    where: { musicVideoId },
    update: {
      path: destPath,
      sizeBytes: BigInt(stat.size),
      qualityId: quality?.id,
      originalFilename: path.basename(sourcePath),
      dateAdded: new Date(),
    },
    create: {
      musicVideoId,
      path: destPath,
      sizeBytes: BigInt(stat.size),
      qualityId: quality?.id,
      originalFilename: path.basename(sourcePath),
    },
  });
  await prisma.musicVideo.update({ where: { id: musicVideoId }, data: { hasFile: true } });
  await prisma.history.create({
    data: {
      musicVideoId,
      eventType: 'downloadFolderImported',
      data: JSON.stringify({
        path: destPath,
        quality: qualityName,
        upgradedFrom: existingFile && existingFile.path !== destPath ? existingFile.path : undefined,
      }),
    },
  });

  return { path: destPath, sizeBytes: BigInt(stat.size) };
}

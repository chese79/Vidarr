import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma, logActivity } from '../db/client.js';
import { renderNamingFormat } from '@vidarr/shared-types';
import { placeFile, replaceFile, type TransferMode } from './transfer.js';
import { writeLibraryMetadata } from './libraryConvention.js';
import { isPathWithinRoot } from './pathContainment.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

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
    include: { artist: { include: { rootFolder: { include: { targetConnector: true } } } } },
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

  const transferMode = settings.transferMode as TransferMode;
  if (existingFile?.path === destPath) {
    await replaceFile(sourcePath, destPath, transferMode);
  } else {
    await placeFile(sourcePath, destPath, transferMode);
  }
  const stat = await fs.stat(destPath);

  await writeLibraryMetadata(destPath, {
    artistName: musicVideo.artist.name,
    title: musicVideo.title,
    year: musicVideo.releaseYear,
    director: musicVideo.director,
    thumbnailUrl: musicVideo.thumbnailUrl,
  });

  const quality = await prisma.quality.findUnique({ where: { name: qualityName } });

  await prisma.$transaction([prisma.musicVideoFile.upsert({
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
  }), prisma.musicVideo.update({
    where: { id: musicVideoId },
    data: { hasFile: true, awaitingServerScanAt: rootFolder.targetConnector ? new Date() : null },
  }), prisma.history.create({
    data: {
      musicVideoId,
      eventType: 'downloadFolderImported',
      data: JSON.stringify({
        path: destPath,
        quality: qualityName,
        upgradedFrom: existingFile && existingFile.path !== destPath ? existingFile.path : undefined,
      }),
    },
  })]);

  // A quality upgrade can change the filename. Keep the previous file until
  // the replacement is fully recorded, and never delete a path outside the
  // configured root if an older record points elsewhere.
  if (existingFile && existingFile.path !== destPath && isPathWithinRoot(rootFolder.path, existingFile.path)) {
    await fs.unlink(existingFile.path).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') await logActivity('warn', 'old-video-cleanup', err).catch(() => {});
    });
  }

  if (rootFolder.targetConnector) {
    try {
      const provider = getLibraryConnectorProvider(rootFolder.targetConnector.type);
      if (provider.refreshVideoLibrary) await provider.refreshVideoLibrary(rootFolder.targetConnector);
    } catch (err) {
      await logActivity('warn', 'media-server-refresh', err);
    }
  }

  return { path: destPath, sizeBytes: BigInt(stat.size) };
}
